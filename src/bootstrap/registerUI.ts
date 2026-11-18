/**
 * Where every registration this plugin makes is listed (`P0-T07`).
 *
 * `docs/07` §2.2 gives this file the job of registering "menus, panes, prefs
 * pane, notifier hooks". `docs/01` §2.4 splits that job in two and the split
 * is not a matter of taste:
 *
 * - **Application-scoped** — `Zotero.PreferencePanes.register`,
 *   `Zotero.MenuManager.registerMenu`, `Zotero.Notifier.registerObserver`,
 *   pref observers, timers. Registered once in `startup`, undone in
 *   `shutdown`. They go in `APP_REGISTRATIONS`.
 * - **Window-scoped** — anything holding a `window`, `document` or `Node`.
 *   Registered per window in `onMainWindowLoad`, undone in
 *   `onMainWindowUnload`. They go in `WINDOW_REGISTRATIONS`.
 *
 * Putting a window-scoped thing in the first list leaks a window per close
 * (`docs/01` §12 gotcha 8), which is why the two lists take different types:
 * a window-scoped entry is a function *of* the window, so it cannot be
 * written without one and cannot be dropped into the app-scoped list.
 *
 * `P0-T07` built the mechanism with both lists empty; `P0-T10` adds the first
 * real entry — the Tools-menu item — and `P0-T09` will add the preference
 * pane. The shape is fixed here: a `ScopedRegistration` built by
 * `registration({ description, register, unregister })`, which does not
 * compile without its `unregister`.
 *
 * Note what this file does *not* contain: any `Zotero.*` call.
 * `eslint.config.js` forbids the `Zotero` global outside `src/zotero/**` and
 * the three lifecycle entry files, so the `register`/`unregister` bodies are
 * built in `src/zotero/` and merely *listed* here. That is the point:
 * composition is separate from the platform call, and the only way to get a
 * platform call executed at startup is to put a fully-specified
 * `Registration` in one of these two arrays.
 *
 * **This file is the composition root's only three-way junction.** It is the
 * one place allowed to import from `src/ui/` *and* `src/zotero/` at once:
 * `docs/07` §2.3 forbids `src/ui/**` from importing `src/zotero/**`, so the
 * menu's shape (`src/ui/menus/toolsMenu.ts`, `src/ui/menus/registerMenus.ts`)
 * and the platform call that installs it (`src/zotero/registrations.ts`) can
 * only meet here. `src/ui/` therefore never learns what a Zotero menu
 * registration is, and `src/zotero/` never learns what this plugin's menus
 * look like.
 *
 * ## It composes Phase 1's two menu entry points (`P1-T19`)
 *
 * The Tools ▸ Research Helper ▸ Search & Import… entry and the collection
 * context-menu entry are described in `src/ui/menus/registerMenus.ts` and
 * registered from {@link APP_REGISTRATIONS} below. Their one command —
 * `openSearchWindow` from `src/ui/dialogs/searchDialog.ts` — is injected here,
 * because the menu knows there is a command, not what a command is made of.
 *
 * ## It also chooses the platform halves of the object graph (`P1-T25`)
 *
 * `installServices()` in `./container.ts` does the wiring; this file chooses
 * the implementations, for two reasons. `registerUI()` is the one function
 * `src/hooks.ts` already hands the **root scope** at startup — and `hooks.ts`
 * is not in `P1-T25`'s `Files` list — so it is the only place a
 * startup-scoped construction can be hooked without touching a path this card
 * does not own. And this file is already the junction that may name
 * `src/zotero/`, which is where `createZoteroHttpTransport()` and
 * `createZoteroPrefStore()` live.
 *
 * Services are installed **before** `APP_REGISTRATIONS`, because a menu
 * handler may issue a request the moment the item exists; teardown is
 * last-in-first-out, so the menu item is removed first and the services come
 * down last.
 *
 * **This file was extended, not replaced** (`plan/README.md` §4, corrected
 * 2026-09-30): `src/hooks.ts` imports both `registerUI` and
 * `registerWindowUI` and is outside `P1-T25`'s `Files` list, so both
 * signatures are unchanged.
 */

import { config, version } from "../../package.json";
import {
  createZoteroLogSink,
  installServices,
  type ProgressHeadlineSource,
  type ScopedRegistration,
  type Scope,
  type ServiceGraph,
  type PipelineJob,
  type ResumedReportRun,
} from "./container";
import {
  LOG_PREFIX,
  createLogRing,
  withLogRing,
  type LogRing,
  type Logger,
} from "../core/logger";
// `P7-T13`: the diagnostics text, its pure builder and its platform half.
import {
  buildDiagnostics,
  diagnosticsJob,
  type DiagnosticsCache,
  type DiagnosticsJob,
} from "../core/diagnostics";
import {
  copyDiagnosticsText,
  pluginErrorLines,
  writeDiagnosticsFile,
  zoteroEnvironment,
} from "../zotero/diagnosticsPlatform";
import { formatValue } from "../i18n/ftl";
import {
  L10N_AUDIO_ATTACHMENT_TITLE,
  L10N_JOB_RESUMED,
  L10N_PROGRESS_HEADLINE,
  L10N_REPORT_PAUSED_NOTICE,
  type FluentMessageId,
} from "../i18n/keys";
// `P6-T17`: the report window's audio section, its host below.
import type { AudioLanguage, AudioRunInput } from "../model/audio";
import {
  AUDIO_REPORT_INPUT_VERSION,
  audioJobInput,
  audioReportExclusivityKey,
  type AudioConfirmAnswer,
  type AudioConfirmRequest,
  type AudioReportOutput,
  type AudioReportPipeline,
  type AudioReportSurface,
} from "../pipeline/audioReport/audioReportPipeline";
import {
  audioFileStem,
  defaultAudioTitle,
  localDate,
} from "../pipeline/audioReport/deliver";
import {
  saveAudioAs,
  saveScriptAsText,
  scriptTextFileName,
} from "../pipeline/audioReport/failures";
import { resolveAudioLanguage } from "../pipeline/audioReport/script";
import { audioFileName as wavFileName } from "../tts/audioStore";
import { GEMINI_TTS_VOICES } from "../tts/geminiTts";
import {
  createZoteroAudioAttachments,
  zoteroAudioFileSystem,
} from "../zotero/attachments";
import { merge } from "../model/merge";
import type { SourceRecord } from "../model/sourceRecord";
import type {
  SearchImportInput,
  SearchImportOutput,
} from "../pipeline/searchImport/types";
import type { Pipeline } from "../pipeline/types";
import { httpRequest } from "../core/http/client";
import { PREFS, PREF_NAMES, getPref, setPref, type PrefName } from "../prefs";
import { PROVIDER_PREF_NAMES } from "./registerProviders";
import type { PluginDatabase } from "./pluginDatabase";
import { RECOMMEND_MAX_POSITIVES } from "../sources/semanticscholar/recommendations";
import { SEMANTICSCHOLAR_KEY_REQUEST_URL } from "../sources/semanticscholar/semanticscholarSource";
import {
  SEARCH_WINDOW_API_PROPERTY,
  openSearchWindow,
  relatedSeedHeader,
  type RelatedSeedHost,
  type SearchWindowArgs,
  type SearchWindowHandle,
  type SearchWindowHost,
  type SearchWindowQuery,
} from "../ui/dialogs/searchDialog";
import {
  openSecretBackendDialog,
  type SecretBackendChoice,
  type SecretBackendDialogHost,
} from "../ui/dialogs/secretBackendDialog";
import {
  USAGE_API_PROPERTY,
  buildAudioDialogModel,
  buildCostDialogModel,
  createUsageHost,
  openCostConfirmDialog,
  type AudioDialogInput,
  type CostDialogHost,
  type CostDialogInput,
  type CostDialogModel,
  type CostDialogOutcome,
  type UsageHostApi,
} from "../ui/dialogs/costConfirmDialog";
import {
  createSessionSpendCounter,
  type SessionSpendCounter,
} from "../pipeline/shared/budget";
import {
  buildEgressDisclosure,
  settleDisclosure,
} from "../pipeline/shared/egressDisclosure";
import type { RecommendPipeline } from "../pipeline/recommend/types";
import type { RelatedPipeline } from "../pipeline/related/types";
import type { RunEstimate } from "../pipeline/shared/estimate";
import { isPrivacyMode } from "../pipeline/shared/privacyPolicy";
import { estimateRelevanceScreen } from "../pipeline/shared/relevanceScreen";
import {
  createRelatedViewModel,
  type RelatedWindowHost,
} from "../ui/viewModels/relatedViewModel";
import {
  createRecommendViewModel,
  type RecommendWindowHost,
} from "../ui/viewModels/recommendViewModel";
import type { ScreeningEstimateRequest } from "../ui/viewModels/searchImportViewModel";
import {
  LLM_CREDENTIALS,
  PREFERENCES_API_PROPERTY,
  PREFERENCES_L10N,
  PREFERENCES_PANE_DESCRIPTION,
  createPreferencesHost,
  preferencePaneOptions,
  type LlmKeyCheck,
  type ModelSuggestions,
  type PreferencesHostApi,
  type AdvancedPort,
  type ContentRemovalPort,
  type ContentSummary,
  type DataResetPort,
  type DiagnosticsPort,
  type SettingsPort,
} from "../ui/prefs/preferencesPane";
import {
  clearData,
  countData,
  deleteAllPluginData,
  reportAudioKeys,
  resetPreferences,
  type DataResetPorts,
} from "../core/dataReset";
import {
  findAllPluginContent,
  pluginContentLibraryIDs,
  trashPluginContent,
  type PluginContent,
} from "../zotero/notes";
import {
  createCancellationTokenSource,
  type CancellationTokenSource,
} from "../core/jobQueue/cancellation";
import {
  modelsFor,
  reloadingUserPriceStore,
} from "../llm/shared/modelCatalogue";
import { POLICY_NOTES } from "../llm/shared/policyNotes";
import type { ProviderId } from "../model/ids";
import { readValidation, recordValidation } from "../zotero/keychain";
import {
  createSearchImportViewModel,
  type MessageFormatter,
  type SearchImportViewModelDeps,
  type SearchWindowHostApi,
} from "../ui/viewModels/searchImportViewModel";
import { buildLibraryIndex, type LibraryIndex } from "../zotero/libraryIndex";
import { provenanceFileWriter, writeProvenanceNote } from "../zotero/notes";
// `P3-T29`: the summarize window, the removal command and their notes.
import {
  collectionsOfItem,
  describeCollectionForSummary,
  removeGeneratedNotes,
  renderSummaryExportHtml,
  renderSummaryNoteHtml,
  reportFileWriter,
  saveSummaryNoteOnce,
} from "../zotero/notes";
import { openZoteroProgressWindow } from "../zotero/progressWindow";
import {
  REMOVE_NOTES_L10N,
  buildSummarizeWindowModel,
  isOfflineFailure,
  confirmSummarizeRun,
  openSummarizeWindow,
  pauseQuestionLine,
  runItemSummary,
  type ItemSummaryDeps,
  type SummarizeConfirmDeps,
  type SummarizeWindowHandle,
  type SummarizeWindowOutcome,
  type SummarizeWindowSession,
  type SummarizeWindowSink,
} from "../ui/dialogs/summarizeDialog";
import {
  SUMMARIZE_INPUT_VERSION,
  summarizeExclusivityKey,
  type SummarizeInput,
  type SummarizePipeline,
  type SummarizeQuestion,
  type SummarizeRunView,
  type SummarizeSurface,
  type SummaryRef,
} from "../pipeline/summarize/summarizePipeline";
import {
  egressLogEntry,
  withEgressLog,
} from "../pipeline/shared/egressDisclosure";
import {
  readCollectionPrivacySettings,
  writeCollectionPrivacySettings,
} from "../pipeline/shared/privacyPolicy";
import { ConfigurationError, ResearchHelperError } from "../core/errors";
import type { FluentLine } from "../ui/dialogs/costConfirmDialog";
import {
  createProvenanceIndex,
  type ProvenanceIndex,
  type ProvenanceStore,
} from "../core/provenance";
import {
  createCacheBlobStore,
  createReportMarkdownFiles,
  openPluginDatabase,
  pluginDatabasePath,
  revealPluginDatabase,
} from "../zotero/db";
import {
  COLLECTION_MENU_DESCRIPTION,
  ITEM_MENU_DESCRIPTION,
  collectionMenuOptions,
  itemMenuOptions,
  withSearchImportEntry,
  type CollectionRunLookup,
  type ItemMenuCommands,
  type SearchMenuCommands,
} from "../ui/menus/registerMenus";
import {
  L10N_MENU_ROOT,
  TOOLS_MENU_DESCRIPTION,
  toolsMenuOptions,
} from "../ui/menus/toolsMenu";
import { createZoteroPrefStore } from "../zotero/prefStore";
import {
  fluentResourceRegistration,
  itemPaneSectionRegistration,
  menuRegistration,
  notifierRegistration,
  preferencePaneRegistration,
} from "../zotero/registrations";
import {
  SUMMARY_NOTIFIER_DESCRIPTION,
  SUMMARY_NOTIFIER_ID,
  SUMMARY_RESULT_L10N,
  SUMMARY_SECTION_DESCRIPTION,
  summaryInvalidationObserver,
  summarySectionOptions,
  type SummarySectionHost,
} from "../ui/panes/summarySection";
import {
  canonicalWorkOfItemID,
  fromZoteroItem,
  relatedSeedOfItemID,
  workKeyOfItemID,
} from "../zotero/itemMapper";
// `P4-T19`: the report window's opener and the model it draws.
import {
  buildReportWindowModel,
  openReportWindow,
  type ReportWindowHandle,
  type ReportWindowHost,
  type ReportWindowSession,
  type ReportWindowSink,
} from "../ui/panes/reportWindow";
// `P4-T20`: the report window's run, its host below.
import {
  IDLE_REPORT_RUN,
  buildReportRunModel,
  confirmReportRun,
  isMainWindowLine,
  pausedJobQuestion,
  reduceReportRun,
  stopForFailure,
  reportPauseQuestion,
  askOnce,
  interfaceReportLanguage,
  resolveReportLanguage,
  settleReportNote,
  windowRunModel,
  type MainWindowLine,
  type ReportConfirmDeps,
  type ReportNoteDeps,
  type ReportQuestion,
  type ReportRunEvent,
  type ReportRunState,
  IDLE_AUDIO_SECTION,
  buildAudioSectionModel,
  initialAudioVoice,
  reduceAudioSection,
  windowAudioModel,
  type AudioSectionEvent,
  type AudioSectionState,
} from "../ui/viewModels/reportViewModel";
import type { JobRecord } from "../core/jobQueue/jobRecord";
import type { TrendReport } from "../model/trend";
import {
  exportReportMarkdown,
  renderReportMarkdown,
  reportExportFileName,
  type ReportExportLabels,
} from "../pipeline/trendReport/exportMarkdown";
import {
  announcePausedReports,
  pausedForAnswer,
  waitingReportJobs,
  pausedReportNoticeArgs,
} from "../pipeline/trendReport/pausedReportNotice";
import { reportLabel } from "../pipeline/trendReport/reportLabels";
import {
  TREND_REPORT_INPUT_VERSION,
  trendReportExclusivityKey,
  type TrendReportDelivery,
  type TrendReportInput,
  type TrendReportListener,
  type TrendReportOutput,
  type TrendReportPipeline,
  type TrendReportSurface,
} from "../pipeline/trendReport/trendReportPipeline";
import { collectionNameOfKey, writeReportNote } from "../zotero/notes";
import { createZoteroHttpTransport, reportError } from "../zotero/zoteroApi";

/**
 * A window-scoped registration, which cannot be built without the window it
 * belongs to.
 */
export type WindowRegistration = (
  win: _ZoteroTypes.MainWindow,
) => ScopedRegistration;

/**
 * What `src/ui/menus/registerMenus.ts`'s two menus are allowed to do.
 *
 * `openSearchWindow` comes from `src/ui/dialogs/searchDialog.ts` and takes the
 * host window as its first parameter, which the menu handler supplies from the
 * element that was clicked — `src/ui/**` may name neither `Zotero` nor
 * `src/zotero/**`, and the clicked window is the right one anyway when two
 * main windows are open. `reportError` is `src/zotero/zoteroApi.ts`'s helper
 * for a caught exception, so a failed command lands in Debug Output rather
 * than in an unhandled rejection (`FR-56`).
 *
 * **Corrected 2026-10-03 (`P1-T32`).** This paragraph used to call
 * `reportError` "`Zotero.logError` + `Zotero.debug` pair". It is not: it
 * formats the message and the stack and forwards to `debug()`, so it reaches
 * `Zotero.debug` **only** — nothing in `src/zotero/` named `Zotero.logError`
 * at all until this card added the `logError` facade. A failed menu command is
 * therefore in Debug Output but was never in `Zotero.getErrors()`. Widening
 * `reportError`'s destination is a behaviour change to seven integration
 * specs' expectations and is left to a card; the `LogSink` channel below is
 * the one `P1-T32` owns.
 */
const SEARCH_MENU_COMMANDS: SearchMenuCommands = {
  // Through {@link openTrackedSearchWindow} since `P5-T15`, so the window is
  // closed at shutdown.
  openSearchWindow: openTrackedSearchWindow,
  onError: reportError,
  // FR-12's "Re-run This Search…" (`P2-T17`), answered from the plugin
  // database once {@link publishProvenanceStore} has published it.
  provenance: {
    hasRunForCollection: (collectionID) => knownRun(collectionID),
    lookupRunForCollection: (collectionID) => lookupRun(collectionID),
  } satisfies CollectionRunLookup,
  // `P3-T29`: FR-19's summarize window and FR-20's removal command, over the
  // graph {@link publishSummarizeCommands} holds.
  openSummarizeWindow: (host, collectionID) =>
    openSummarizeWindowCommand(host, collectionID),
  removeGeneratedNotes: (host, collectionID) =>
    removeGeneratedNotesCommand(host, collectionID),
  // `P4-T19`: FR-25's report window, over the graph
  // {@link publishReportWindowCommands} holds.
  openReportWindow: (host, collectionID) =>
    openReportWindowCommand(host, collectionID),
  // `P6-T17`: "Generate Audio Report…" opens the same window, behind the hidden
  // `audio.enabled`; the third reader is `openAudioReportWindowCommand` itself.
  audioEnabled: () => getPref("audioEnabled"),
  openAudioReportWindow: (host, collectionID) =>
    openAudioReportWindowCommand(host, collectionID),
  // FR-44 (`P5-T26`): the entry's two readers of the hidden preference. The third
  // is `openRecommendWindowCommand` itself.
  recommendEnabled: () => getPref("recommendEnabled"),
  openRecommendWindow: (host, collectionID) =>
    openRecommendWindowCommand(host, collectionID),
};

/**
 * The search window this instance last opened, closed at shutdown by
 * {@link publishSearchWindowCommands} (`P5-T15`; `docs/08` §5.2's note of
 * 2026-11-02). One handle is enough: the window's name makes it a singleton.
 */
const searchWindowState: { win: SearchWindowHandle | undefined } = {
  win: undefined,
};

/** `openSearchWindow`, remembering the window for {@link searchWindowState}. */
function openTrackedSearchWindow(
  host: SearchWindowHost,
  args: SearchWindowArgs,
): SearchWindowHandle {
  const win = openSearchWindow(host, args);
  searchWindowState.win = win;
  return win;
}

/**
 * FR-13's "Find Related Papers…" (`P5-T15`): open the search window on the seed.
 * Opens nothing while the hidden `related.enabled` is off (`docs/07` §8.5),
 * read on every call.
 */
function openRelatedWindowCommand(
  host: SearchWindowHost,
  seedItemID: number,
): SearchWindowHandle | undefined {
  if (!getPref("relatedEnabled")) return undefined;
  return openTrackedSearchWindow(host, { mode: "related", seedItemID });
}

/**
 * FR-44's window (`P5-T26`; `docs/08` §5.4). Opens nothing while the hidden
 * `recommend.enabled` is off (`docs/07` §8.5), read on every call. Opening it sends
 * nothing: the window starts no run by itself.
 */
function openRecommendWindowCommand(
  host: SearchWindowHost,
  collectionID: number,
): SearchWindowHandle | undefined {
  if (!getPref("recommendEnabled")) return undefined;
  return openTrackedSearchWindow(host, {
    mode: "recommend-from-collection",
    collectionID,
  });
}

/**
 * What `itemMenuOptions` may do. Separate from {@link SEARCH_MENU_COMMANDS}
 * because the item menu has its own selection and one command.
 */
const ITEM_MENU_COMMANDS: ItemMenuCommands = {
  relatedEnabled: () => getPref("relatedEnabled"),
  openRelatedWindow: openRelatedWindowCommand,
  onError: reportError,
};

declare module "../addon" {
  interface PluginApi {
    /**
     * FR-13's opener (`P5-T15`), the command the item menu's "Find Related
     * Papers…" runs. Published, as `reportWindow` is, so an integration spec —
     * bundled separately — can open the real window through the plugin's own
     * state and see it closed at shutdown.
     */
    relatedWindow?: RelatedWindowCommands;
    /** FR-44's opener (`P5-T26`), published for the same reason. */
    recommendWindow?: RecommendWindowCommands;
  }
}

/** {@link PluginApi.recommendWindow}. */
export interface RecommendWindowCommands {
  /** The window, or `undefined` while `recommend.enabled` is off. */
  open(
    host: SearchWindowHost,
    collectionID: number,
  ): SearchWindowHandle | undefined;
}

/** {@link PluginApi.relatedWindow}. */
export interface RelatedWindowCommands {
  /** The window, or `undefined` while `related.enabled` is off. */
  open(
    host: SearchWindowHost,
    seedItemID: number,
  ): SearchWindowHandle | undefined;
}

// ---------------------------------------------------------------------------
// FR-12's provenance store (`P2-T17`)
// ---------------------------------------------------------------------------

/**
 * The plugin database's lifecycle state, held for the menu and the view model.
 *
 * `ready` is the startup open-and-migrate, **not awaited by startup**:
 * `docs/10` NFR-10 allows the plugin 200 ms of startup and `P1-T23`'s
 * measurement already runs close to it, so the SQLite open runs alongside the
 * rest of startup and everything that needs the store awaits `ready` instead.
 * It resolves to `undefined` — never rejects — when the database cannot be
 * opened or migrated, which is `P2-T17`'s Notes' degradation: "Re-run This
 * Search…" is absent, never broken.
 */
const provenanceState: {
  index: ProvenanceIndex | undefined;
  ready: Promise<ProvenanceIndex | undefined> | undefined;
} = { index: undefined, ready: undefined };

/**
 * `docs/08` §2.4's `hasRunForCollection`, synchronously, over the index: the
 * cached answer; `undefined` while it is not known yet — including while the
 * database is still opening; `false` when no database was ever started or the
 * id names no collection.
 */
function knownRun(collectionID: number): boolean | undefined {
  const ref = addon.platform.collectionById(collectionID);
  if (ref === undefined) return false;
  const index = provenanceState.index;
  if (index === undefined) {
    return provenanceState.ready === undefined ? false : undefined;
  }
  return index.known(ref.libraryId, ref.key);
}

/** The asynchronous half: wait for the database, ask it, cache the answer. */
async function lookupRun(collectionID: number): Promise<boolean> {
  const ref = addon.platform.collectionById(collectionID);
  const index = await provenanceState.ready;
  if (index === undefined || ref === undefined) return false;
  return index.hasRun(ref.libraryId, ref.key);
}

/**
 * The view model's `provenanceStore`, bound before the database has finished
 * opening: every call waits for {@link provenanceState}'s `ready`.
 *
 * A write with no database throws, so the view model logs the missing row
 * rather than believing it was stored; a read with no database finds nothing,
 * so the window opens unseeded.
 */
const DEFERRED_PROVENANCE_STORE: ProvenanceStore = {
  async putProvenance(record, libraryId, collectionKey, noteKey) {
    const index = await provenanceState.ready;
    if (index === undefined) {
      throw new Error(
        "[research-helper] the plugin database is not available, so the " +
          "run's search_provenance row cannot be written.",
      );
    }
    await index.putProvenance(record, libraryId, collectionKey, noteKey);
  },
  async findProvenanceByCollection(libraryId, collectionKey) {
    const index = await provenanceState.ready;
    return index?.findProvenanceByCollection(libraryId, collectionKey);
  },
};

/**
 * Publish FR-12's store over the plugin database the service graph opened
 * (`P2-T17`), and withdraw it again on shutdown.
 *
 * **The database is no longer opened here** (`P3-T33`; `plan/00` §6 item
 * 249, owner, 2026-10-21). `installServices` opens the one connection through
 * `installPluginDatabase` (`src/bootstrap/pluginDatabase.ts`), shares it with
 * the cache and the job store, attaches the job store and runs the startup
 * recovery, and closes it in the graph's own teardown — which runs after this
 * registration's, because it was registered first. What stays here is what the
 * search window and the menu read: {@link provenanceState}, and
 * `api.provenance` for the integration spec.
 *
 * `docs/07` §8.4: the file is `<Zotero.DataDirectory.dir>/research-helper.sqlite`,
 * resolved by `Zotero.DBConnection` from the name, never a hard-coded path and
 * never Zotero's own `zotero.sqlite`.
 *
 * Teardown waits for an open that is still in flight, so the store is never
 * published after it has been withdrawn.
 */
async function publishProvenanceStore(
  scope: Scope,
  graph: ServiceGraph,
): Promise<void> {
  // Captured once, for the reason {@link publishServiceGraph} gives.
  const api = addon.api;
  await scope.use({
    description: "the plugin database's provenance store (api.provenance)",
    register: () => {
      const ready = graph.database.ready.then(
        (open): ProvenanceIndex | undefined => {
          if (open === undefined) return undefined;
          const index = createProvenanceIndex(open.provenance);
          provenanceState.index = index;
          api.provenance = {
            index,
            database: open.connection,
            path: open.path,
            schemaVersion: open.schemaVersion,
          };
          return index;
        },
      );
      provenanceState.ready = ready;
      // Wrapped, so `scope.use` does not await the open: startup goes on.
      return { ready };
    },
    unregister: async ({ ready }) => {
      await ready;
      delete api.provenance;
      provenanceState.index = undefined;
      provenanceState.ready = undefined;
    },
  });
}

/**
 * Registered in `startup`, torn down in `shutdown`.
 *
 * Both menu items are application-scoped, not window-scoped: `docs/01` §2.4
 * and `docs/08` §2.4 both say to register menus once in `startup`, and
 * Zotero 10's `MenuManager` propagates a registration to every open window and
 * removes the elements again on unregister.
 *
 * `menuRegistration()`, `toolsMenuOptions()` and `withSearchImportEntry()` all run
 * at module-evaluation time and none touches the platform (`collectionMenuOptions()`
 * does at registration since `P5-T26`, reading one preference): the first returns a closure, the rest plain objects. Nothing
 * reaches `Zotero.MenuManager` until `registerUI()` feeds this array to a live
 * `Scope`.
 *
 * Two registrations, one per target (`P1-T19`), because `docs/08` §2.3 allows
 * exactly one top-level item per context and
 * `Zotero.MenuManager.registerMenu` takes one target per call. The Tools entry
 * is `./toolsMenu.ts`'s submenu **extended** with Phase 1's Search & Import
 * command, because a second Tools registration would be a second top-level
 * item. *Changed 2026-11-17 (`plan/10` `P7-T04`):* `P0-T10`'s spike command,
 * which this registration used to carry below the Search & Import entry, is
 * retired; its fixture is `test/integration/support/spikeArticle.ts`.
 */
const APP_REGISTRATIONS: readonly ScopedRegistration[] = [
  menuRegistration(
    TOOLS_MENU_DESCRIPTION,
    withSearchImportEntry(toolsMenuOptions(), SEARCH_MENU_COMMANDS),
  ),
  // The hidden `report.enabled` that held the report entry back (item 307(d))
  // was removed on 2026-11-02: the window can generate a report (`P4-T20`).
  // A function since `P5-T26`: the options read the hidden `recommend.enabled`, which
  // needs `installServices` to have installed the preference store.
  async (scope) => {
    await menuRegistration(
      COLLECTION_MENU_DESCRIPTION,
      collectionMenuOptions(SEARCH_MENU_COMMANDS),
    )(scope);
  },
  // FR-13 (`P5-T15`), the first `main/library/item` registration. Not registered
  // at all while the hidden `related.enabled` is off (`docs/11` §0 principle 5),
  // so the item menu holds no empty submenu and no separator of ours. Read here,
  // after `installServices` installed the preference store, as item 307(d) read
  // `report.enabled`.
  async (scope) => {
    if (!getPref("relatedEnabled")) return;
    await menuRegistration(
      ITEM_MENU_DESCRIPTION,
      itemMenuOptions(ITEM_MENU_COMMANDS),
    )(scope);
  },
  // The preference pane (`P1-T44`). Application-scoped: `docs/01` §2.4 lists
  // `Zotero.PreferencePanes.register` with the once-per-startup registrations,
  // and Zotero propagates it to every open `zotero:pref` window itself. Through
  // `preferencePaneRegistration` so the pane is paired with its unregister and
  // visible to `liveHandles()`; `hooks.ts`'s `reportSurvivors` reads
  // `pluginPanes` after teardown and now has something to find. The literal
  // plugin ID is D9's permanent constant, read from `package.json` as every
  // other registration here reads it.
  preferencePaneRegistration(
    PREFERENCES_PANE_DESCRIPTION,
    preferencePaneOptions(config.addonID),
  ),
];

/**
 * The main-window Fluent resource id (`docs/08` §10.1's `mainWindow` surface).
 *
 * Flat and plugin-prefixed, because Zotero 10.0.1's `registerLocales()` drops
 * subdirectories under `locale/<locale>/` and registers every plugin's bundle
 * in one shared `zotero-plugins:{locale}/<filename>` namespace (`docs/01`
 * §9.1). The prefix is `config.addonRef` rather than a second literal, and
 * `zotero-plugin.config.ts` turns scaffold's `prefixLocaleFiles` off, so the
 * built file keeps its source name, `addon/locale/<locale>/` +
 * `${addonRef}-mainWindow.ftl`. `fluentResourceRegistration` then asserts the
 * name at runtime by resolving a real message out of it: a mismatch throws
 * instead of rendering blank labels.
 */
const MAIN_WINDOW_FTL = `${config.addonRef}-mainWindow.ftl`;

/**
 * Registered per main window, torn down when that window closes.
 *
 * The Fluent bundle is first: `docs/08` §10.1 wants it in the window before
 * any plugin DOM is, and teardown runs last-in-first-out, so it is also the
 * last thing removed.
 */
const WINDOW_REGISTRATIONS: readonly WindowRegistration[] = [
  (win) =>
    fluentResourceRegistration("main-window Fluent bundle", win, {
      resourceId: MAIN_WINDOW_FTL,
      probeMessageId: L10N_MENU_ROOT,
    }),
];

/**
 * The progress popup's headline, resolved from Fluent at startup (`P1-T32`
 * item 3 and `Do` step 4).
 *
 * **`new Localization([...])` is `docs/08` §10.1's "From JS, no window" row**,
 * and `test/integration/l10n.spec.ts` layer 5 reads an unpinned one as "the
 * form the plugin sandbox uses". It is the only route available here:
 * `Zotero.getString()` *throws* on a plugin key under an `en-US` locale
 * (`docs/08` §8.2.1) because a plugin's `.ftl` lives in `L10nRegistry` and not
 * in that synchronous bundle, and `document.l10n` needs a window the
 * application-scoped graph does not have.
 *
 * A `Localization` is built per lookup rather than kept, because this is one
 * lookup for the life of the plugin and a cached one would pin the locale
 * chain as it stood at startup.
 *
 * **What is still unresolved, and is reported rather than papered over:** this
 * runs inside `startup`, and nothing in the corpus states whether Zotero's own
 * `registerLocales()` has contributed this plugin's bundle to the
 * `zotero-plugins` `L10nFileSource` by then. If it has not, `resolve()` yields
 * `undefined`, `installServices` logs a `warn` naming the id, and the popup
 * carries {@link ProgressHeadlineSource.fallback} — which is the same string
 * the user saw before this card, with the difference that the substitution is
 * now in the debug log a bug report carries instead of in a code comment.
 */
const PROGRESS_HEADLINE: ProgressHeadlineSource = {
  messageId: L10N_PROGRESS_HEADLINE,
  async resolve(): Promise<string | undefined> {
    return formatValue(
      new Localization([MAIN_WINDOW_FTL]),
      L10N_PROGRESS_HEADLINE,
    );
  },
  // `config.addonName`, which is what `P1-T25` passed unconditionally and what
  // the en-US bundle's text is anyway. It is a fallback now rather than the
  // headline: reaching it is logged.
  fallback: config.addonName,
};

// ---------------------------------------------------------------------------
// The Search & Import window's host (`P1-T35`)
// ---------------------------------------------------------------------------

/**
 * The view model's dependencies, with **every optional member made required**.
 *
 * This is `P1-T35` criterion 4's enumeration, and it is derived from
 * `SearchImportViewModelDeps` by a mapped type rather than written out, so it
 * **cannot go stale**: adding a member to that interface — optional or not —
 * immediately makes {@link searchWindowDeps} fail to satisfy this type, and
 * `npm run typecheck` fails until the new member is wired here. A hand-written
 * list of today's five optional names would have to be remembered; this one is
 * the interface itself.
 *
 * It does **not** change `SearchImportViewModelDeps`' shape (`P1-T35`'s
 * **Do NOT**). The optionality is what lets a unit test build a view model with
 * no platform at all; `Required<…>` is a separate, stricter contract that only
 * the composition root is held to — which is exactly where the card says the
 * fix for silent degradation belongs.
 */
export type SearchWindowDeps = Required<SearchImportViewModelDeps>;

/**
 * The library snapshot {@link SearchWindowDeps.isExisting} reads.
 *
 * `P1-T13` shipped the existing-item check in `src/zotero/libraryIndex.ts`
 * (grepped 2026-10-07: `findExisting` is declared at `libraryIndex.ts:157` and
 * implemented at `:322`; `src/zotero/importer.ts` and
 * `src/bootstrap/registerPipelines.ts` are its only other callers). That check
 * is **synchronous** by design and the snapshot behind it is **async** to
 * build, so the two cannot be bridged inside the port: the index has to exist
 * before the first row is mapped.
 */
let libraryIndex: LibraryIndex | undefined;

/**
 * Rebuild the library snapshot, or leave the last one in place.
 *
 * A failure here must not stop a search: the consequence is that rows are not
 * badged as already present, which is the same degradation the view model
 * documents for an absent `isExisting`, and it is logged rather than silent.
 */
async function refreshLibraryIndex(logger: Logger): Promise<void> {
  try {
    const rebuilt = await buildLibraryIndex();
    libraryIndex = rebuilt;
    logger.debug("library index rebuilt for the search window", {
      doiKeys: rebuilt.byDoi.size,
      pmidKeys: rebuilt.byPmid.size,
      itemsScanned: rebuilt.stats.itemsScanned,
      elapsedMs: rebuilt.stats.elapsedMs,
    });
  } catch (error) {
    logger.warn(
      "the library index could not be rebuilt; result rows will not be " +
        "marked as already present until the next search",
      { reason: error instanceof Error ? error.name : typeof error },
    );
  }
}

/**
 * The `workKey` the pipeline mints for `record` as a group of one, for
 * {@link SearchWindowDeps.isExisting} (`P2-T37`).
 *
 * The window's port hands over a `SourceRecord`, whose `work` carries no key,
 * and `findExisting` without one cannot reach the `hash:` arm — so a row with
 * no DOI, PMID, arXiv id or S2 corpus id was never marked as already in the
 * library (`P2-T16` Part A, defect D1). `merge` of the one record is the same
 * derivation the `Merging` stage applies to a singleton group, so the key is
 * the one the importer wrote as `rh-work-key`, with no second copy of
 * `buildWorkKey`'s inputs here.
 *
 * `undefined` if `merge` refuses the record, which leaves the lookup exactly
 * as it was before this card: a badge is not worth breaking the table over.
 */
function singletonWorkKey(record: SourceRecord): string | undefined {
  try {
    return merge([record], record.retrievedAtEpochMs).work.workKey;
  } catch {
    return undefined;
  }
}

/**
 * Everything the view model needs, with nothing left optional.
 *
 * Each platform member and where it comes from:
 *
 * | member | bound to |
 * |---|---|
 * | `listSources` | {@link ServiceGraph.sources}, the registry `registerSources()` filled |
 * | `listCollections` | `addon.platform.listCollections()` — `Zotero.Collections`, read in the one file allowed to name it |
 * | `getPrefs` | `src/prefs`' typed `getPref`, the four `docs/07` §8.5 window seeds |
 * | `saveSources` | `setPref("sources", …)` — the Databases row is the preference's control (`P2-T14`) |
 * | `semanticScholarKeyStatus` | `getPref("semanticscholarKeyPresent")` and `SEMANTICSCHOLAR_KEY_REQUEST_URL` — FR-2's notice (`P2-T14`) |
 * | `isExisting` | `P1-T13`'s `LibraryIndex.findExisting`, over {@link libraryIndex} |
 * | `writeProvenanceNote` | `src/zotero/notes.ts`'s `writeProvenanceNote`, `FR-8`'s note |
 * | `provenanceFiles` | `src/zotero/notes.ts`'s `provenanceFileWriter()`, `FR-8`'s JSON export |
 * | `screening` | `getPref("screeningThreshold")` and the LLM registry's `isConfigured` for the active provider (`P3-T27`); since item 281(b), {@link estimateScreeningCost}, `summary.confirmAboveCents`, {@link confirmScreeningCost} and the application locale |
 *
 * The last three are the ones `P1-T22` could not make, because `src/ui/**` may
 * not import `src/zotero/**` (`docs/07` §2.3) and no file in that card's
 * `Files` list could reach either module. This file is the three-way junction
 * where they can be bound, which is what its header has said since `P0-T07`.
 *
 * **What this file cannot bind, and `P1-T36` measured why.** The *destination*
 * half of the JSON export — the file chooser — is not here and cannot be. A
 * chooser needs a `BrowsingContext` (`docs/01`:436), only a window has one, and
 * `eslint.config.js`'s `research-helper/zotero-global` rule does not exempt this
 * file, so it cannot reach `Zotero.getMainWindow()` to borrow one either. The
 * window document opens the chooser and hands the path to
 * `host.exportProvenance(path)`; this file binds only the write.
 *
 * `getPrefs` reads on **every** call rather than latching a snapshot: `getPref`
 * never throws (`docs/07` §8.5.1) and the window re-seeds its controls from
 * this each time it opens, so a preference changed between two opens has to be
 * visible without a restart.
 */
/**
 * docs/08 §10.1's "From JS, no window" row: both bundles, because a toast can be worded
 * from either and its window may be gone by then.
 */
function toastFormatter(): MessageFormatter {
  return new Localization([
    `${config.addonRef}-searchDialog.ftl`,
    MAIN_WINDOW_FTL,
  ]) as unknown as MessageFormatter;
}

function searchWindowDeps(
  graph: ServiceGraph,
  pipeline: Pipeline<SearchImportInput, SearchImportOutput>,
  logger: Logger,
): SearchWindowDeps {
  return {
    pipeline,
    toastFormatter: toastFormatter(),
    jobs: graph.pipelineContext,
    logger,
    pluginVersion: version,
    zoteroVersion: addon.platform.zoteroVersion,
    clock: graph.clock,
    listSources: () =>
      graph.sources.list().map((source) => ({
        id: source.id,
        displayNameKey: source.displayNameKey,
        // `P2-T14`: the window draws bioRxiv's and medRxiv's `⊕` role row
        // from this capability, never from the adapters' English notice.
        keywordSearch: source.capabilities.keywordSearch,
      })),
    listCollections: () => addon.platform.listCollections(),
    getPrefs: () => ({
      sources: getPref("sources"),
      searchYears: getPref("searchYears"),
      maxResults: getPref("maxResults"),
      hideExisting: getPref("hideExisting"),
    }),
    // FR-2's third scenario (`P2-T14`). The presence flag, never the key
    // (decision D5); read per call so a key stored after startup is seen.
    semanticScholarKeyStatus: () => ({
      present: getPref("semanticscholarKeyPresent"),
      requestUrl: SEMANTICSCHOLAR_KEY_REQUEST_URL,
    }),
    // `P2-T14` step 1: the window's checkboxes are the `sources` preference's
    // control (`docs/07` §8.5's row), written through the typed accessor.
    saveSources: (ids) => {
      setPref("sources", ids.join(","));
    },
    // `ExternalIds` and the work key in, boolean out: `findExisting`
    // re-normalizes the identifiers itself, so a record whose DOI is cased
    // differently from the stored one still matches. The key is what reaches a
    // record with no DOI, PMID, arXiv id or S2 corpus id (`P2-T37`).
    isExisting: (record) =>
      libraryIndex?.findExisting(record.work.ids, singletonWorkKey(record)) !==
      undefined,
    // The default `deps` argument builds `new Zotero.Item("note")`, which is
    // `docs/01` §5.7's standalone-note sequence. The record handed over has
    // already been through `src/core/provenance.ts`'s redaction gate — the
    // view model calls `redactSearchProvenance` before this port — and nothing
    // here adds a second rule (`NFR-16`: one gate).
    writeProvenanceNote: (provenance) => writeProvenanceNote(provenance),
    // `FR-8`'s third scenario. The **port**, not `exportProvenanceJson`: the
    // view model calls `src/core/provenance.ts`'s `exportJson`, so the
    // serialisation and the one redaction gate stay in `core/` and the platform
    // contributes `Zotero.File.putContentsAsync` and nothing else.
    provenanceFiles: provenanceFileWriter(),
    // FR-12 (`P2-T17`): the search_provenance store, which waits for the
    // database `installServices` opens ({@link publishProvenanceStore}), and
    // the collection lookup a
    // re-run is seeded through — `Zotero.Collections.get`, read by the one file
    // allowed to name it (`src/addon.ts`).
    provenanceStore: DEFERRED_PROVENANCE_STORE,
    findCollection: (collectionID) => {
      const ref = addon.platform.collectionById(collectionID);
      return ref === undefined
        ? undefined
        : { libraryId: ref.libraryId, collectionKey: ref.key, name: ref.name };
    },
    // `P3-T27` (`docs/08` §4.2's threshold row): the control opens at the
    // preference, read per open; screening is offered only while the active
    // provider can be called. Nothing here writes the preference.
    screening: {
      threshold: () => getPref("screeningThreshold"),
      available: () =>
        graph.llm.registry.isConfigured(graph.llm.registry.activeProviderId()),
      // Owner, 2026-10-24, `plan/00` §6 item 281(b): the cost beside the
      // checkbox, and `P3-T16`'s dialog above `summary.confirmAboveCents`.
      estimate: (request) => estimateScreeningCost(graph, request),
      confirmAboveCents: () => getPref("summaryConfirmAboveCents"),
      confirm: (estimate) => confirmScreeningCost(graph, estimate),
      locale: appLocale,
    },
  };
}

/**
 * Item 281(b) (owner, 2026-10-24): price a relevance screen before it runs —
 * `estimateRelevanceScreen` over the router's `"screening"` model, the
 * bundled `RELEVANCE_SCREEN` template and the graph's one price source,
 * `modelPrices` (item 278(b)), which is the snapshot the spend guard reserves
 * the screen's calls with. No catalogue request is sent: the snapshot held is
 * read as it stands.
 *
 * @param graph - the service graph
 * @param request - the result count and the topic
 * @returns the estimate; rejects when the model or the template cannot be read
 */
async function estimateScreeningCost(
  graph: ServiceGraph,
  request: ScreeningEstimateRequest,
): Promise<RunEstimate> {
  // A lazy import, as the `Screening` stage's own: `../prompts/bundled`
  // imports the `.md` prompt files (`src/pipeline/searchImport/stages.ts`).
  const { PROMPT_REGISTRY } = await import("../prompts/bundled");
  const model = graph.llm.router.resolveModel("screening");
  return estimateRelevanceScreen({
    resultCount: request.resultCount,
    request: { topic: request.topic },
    prompt: PROMPT_REGISTRY.get("RELEVANCE_SCREEN"),
    modelId: model.modelId,
    prices: graph.modelPrices.pricesFor(model.providerId, model.modelId),
    atEpochMs: graph.clock.now(),
  });
}

/**
 * Item 281(b): `P3-T16`'s cost dialog over a screen's estimate, through
 * {@link confirmRunCost} — the same window and model as a summary run, not a
 * second dialog. It carries `P3-T15`'s disclosure for the `"screening"`
 * model under the global privacy mode (a search has no collection), and no
 * "Don't ask again for this collection" box. Confirming a dialog that showed
 * the first-job notice records the acknowledgement (`settleDisclosure`).
 *
 * @param graph - the service graph
 * @param estimate - from {@link estimateScreeningCost}
 * @returns what the user chose; rejects when no window can show the number
 */
async function confirmScreeningCost(
  graph: ServiceGraph,
  estimate: RunEstimate,
): Promise<CostDialogOutcome> {
  const providerId = graph.llm.router.resolveModel("screening").providerId;
  const mode = getPref("privacyMode");
  const disclosure = buildEgressDisclosure(
    {
      providerId,
      modelId: estimate.modelId,
      // The search job's own reading (`container.ts`'s `globalPrivacyMode`):
      // a job over no collection follows the global mode; unreadable is strict.
      privacyMode: isPrivacyMode(mode) ? mode : "strict",
      items: Array.from(
        { length: estimate.selected.counts.items },
        () => "abstract" as const,
      ),
    },
    { baseUrls: graph.llm.baseUrls },
  );
  const outcome = await confirmRunCost({
    mode: "preflight",
    estimate,
    disclosure,
    confirmAboveCents: getPref("summaryConfirmAboveCents"),
    fullTextAutoMaxPapers: getPref("summaryFullTextAutoMaxPapers"),
    providerName: await providerDisplayName(graph, providerId),
    ceilingSelected: undefined,
    ceilingDowngrade: undefined,
    session: sessionSpend.totals,
    offerDontAskAgain: false,
  });
  settleDisclosure(
    disclosure,
    outcome.kind === "run" ? "confirmed" : "cancelled",
  );
  return outcome;
}

/**
 * The provider's name for the cost dialog's destination line: its
 * `displayNameKey` resolved in the main-window bundle, or the provider id when
 * it resolves to nothing (the names are brand names, never translated).
 */
async function providerDisplayName(
  graph: ServiceGraph,
  providerId: ProviderId,
): Promise<string> {
  const key = graph.llm.registry.get(providerId)?.displayNameKey;
  if (key === undefined) return providerId;
  try {
    const name = await formatValue(
      new Localization([MAIN_WINDOW_FTL]),
      key as FluentMessageId,
    );
    return name ?? providerId;
  } catch {
    return providerId;
  }
}

/**
 * Which members of {@link SearchWindowDeps} are missing at run time.
 *
 * The compiler already makes an unwired member impossible to ship, so this can
 * only fire when a *value* is `undefined` — a getter that threw, a service the
 * graph left out. Enumerated from the object rather than from a literal list of
 * names for the same reason {@link SearchWindowDeps} is a mapped type: a list
 * written here would be a second thing to keep in step.
 */
function missingDependencies(deps: SearchWindowDeps): readonly string[] {
  return Object.entries(deps)
    .filter(([, value]) => value === undefined)
    .map(([name]) => name)
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Hold the graph on the plugin instance, and drop it again on teardown.
 *
 * Through `scope.use` rather than by assignment so that the holder is undone by
 * `hooks.onShutdown`'s single `unregisterAll()` — a stale `ServiceGraph` left
 * on a disabled plugin's instance would keep its rate limiters, its HTTP client
 * and every open progress surface reachable (`docs/01` §12 gotcha 10).
 *
 * **The target object is captured once, not re-read from the `addon` global in
 * the teardown.** A disable/enable cycle deletes the plugin object off `Zotero`
 * and `src/index.ts` news up a fresh `Addon` with a fresh `api`, so a teardown
 * that said `delete addon.api.services` would delete from whichever instance
 * the global happened to name when it ran rather than from the one the
 * registration wrote to. In the ordering `hooks.ts` uses today those are the
 * same object — `unregisterAll()` runs before `delete Zotero[addonInstance]` —
 * so this is not a live defect; it is the `Registration` contract's own
 * requirement that `unregister` undo exactly what `register` did, and
 * `test/integration/menus.spec.ts` cycles disable/enable five times looking for
 * precisely this class of mistake.
 */
async function publishServiceGraph(
  scope: Scope,
  graph: ServiceGraph,
): Promise<void> {
  const api = addon.api;
  await scope.use({
    description: "the service graph on the plugin instance (api.services)",
    register: () => {
      api.services = graph;
      return "api.services";
    },
    unregister: () => {
      delete api.services;
    },
  });
}

/**
 * Build the window's host and publish it where the document looks for it.
 *
 * **The property is imported, never respelled** (`P1-T35` step 3):
 * {@link SEARCH_WINDOW_API_PROPERTY} is declared beside the document's own
 * `resolveHost()` contract in `src/ui/dialogs/searchDialog.ts`, so the
 * publishing side and the reading side cannot drift.
 *
 * **A search refreshes the library snapshot before it starts.** `runSearch` is
 * wrapped for exactly that: `isExisting` is synchronous and `buildLibraryIndex`
 * is not, and the one point where an `await` can be inserted without changing
 * `SearchImportViewModelDeps` is the host boundary. Doing it here rather than
 * on a timer or a notifier observer keeps `docs/02` §11.6's budget — **one**
 * `Zotero.Search` per run, independent of library size — and makes the badge
 * deterministic instead of racing the fetch, which is the defect
 * `ensureSourceNames` had to be rewritten for in `P1-T22`. The cost is one
 * index build before each search; the alternative, badging rows from a snapshot
 * taken at startup, is wrong the moment the user imports anything.
 *
 * Nothing else is wrapped. `runImport` leaves the snapshot stale on purpose:
 * the *pipeline* builds its own index for the write (`registerPipelines.ts`'s
 * `writeBatch`), so duplicate detection during the import is already correct,
 * and the next search refreshes the badge.
 */
async function publishSearchWindowHost(
  scope: Scope,
  graph: ServiceGraph,
): Promise<void> {
  const logger = graph.logger.child({ surface: "searchWindow" });

  // `PipelineRegistry.get()` is typed `Pipeline<never, unknown>` on purpose —
  // see `src/pipeline/registry.ts`'s header — so the caller that knows which
  // pipeline it wants narrows at the construction site. This is that site.
  const erased = graph.pipelines.get("searchImport");
  if (erased === undefined) {
    // Startup is not failed over this: the menus still register and the window
    // still opens, inert, exactly as it did before this card. What changes is
    // that the reason is in the debug log instead of nowhere.
    logger.error(
      "the searchImport pipeline is not registered, so the Search & Import " +
        "window has no host and every control in it will be inert",
      { pipelines: graph.pipelines.list().length },
    );
    return;
  }
  const pipeline = erased as Pipeline<SearchImportInput, SearchImportOutput>;

  const deps = searchWindowDeps(graph, pipeline, logger);
  const missing = missingDependencies(deps);
  if (missing.length > 0) {
    // Reported, not thrown. `FR-56`'s shape: a plugin that refused to load
    // because one optional port resolved to `undefined` would be a worse
    // outcome than one that searches and does not badge a row. The names are in
    // the line because that is what makes it actionable.
    logger.error(
      "the Search & Import window's host is missing dependencies and will " +
        "degrade silently in the ways each one's doc comment describes",
      { missing: missing.join(",") },
    );
  }

  const model = createSearchImportViewModel(deps);
  const published = model.host;
  // FR-13 to FR-18 (`P5-T16`): the related mode's own model. A build with no related
  // pipeline leaves the member absent, and the window stays on its first panel.
  const relatedPipeline = graph.pipelines.get("related") as
    RelatedPipeline | undefined;
  if (relatedPipeline === undefined) {
    logger.error(
      "the related pipeline is not registered, so Find Related Papers… will " +
        "open a window that shows no run",
      { pipelines: graph.pipelines.list().length },
    );
  }
  const related =
    relatedPipeline === undefined
      ? undefined
      : createRelatedViewModel({
          pipeline: relatedPipeline,
          toastFormatter: toastFormatter(),
          jobs: graph.pipelineContext,
          logger,
          keyRequestUrl: SEMANTICSCHOLAR_KEY_REQUEST_URL,
          // `P5-T17`: the window's import, through this function's own pipeline.
          imports: {
            pipeline,
            listCollections: () => addon.platform.listCollections(),
            linkToSeed: () => getPref("relatedLinkToSeed"),
            seedLibraryId: async (itemID) =>
              (await relatedSeedOfItemID(itemID))?.libraryID,
          },
        }).host;
  // FR-44 (`P5-T26`): the recommend mode's own model, the same way.
  const recommendPipeline = graph.pipelines.get("recommend") as
    RecommendPipeline | undefined;
  if (recommendPipeline === undefined) {
    logger.error(
      "the recommend pipeline is not registered, so the recommend window will " +
        "show no run",
      { pipelines: graph.pipelines.list().length },
    );
  }
  const recommend =
    recommendPipeline === undefined
      ? undefined
      : createRecommendViewModel({
          pipeline: recommendPipeline,
          toastFormatter: toastFormatter(),
          jobs: graph.pipelineContext,
          logger,
          keyRequestUrl: SEMANTICSCHOLAR_KEY_REQUEST_URL,
          maxPaperIdentifiers: RECOMMEND_MAX_POSITIVES,
          collectionOf: (collectionID) => {
            const collection = addon.platform.collectionById(collectionID);
            return collection === undefined
              ? undefined
              : {
                  libraryID: collection.libraryId,
                  collectionKey: collection.key,
                  name: collection.name,
                };
          },
          confirm: reportConfirmDeps(graph),
          askBudget: async (question) => {
            const outcome = await confirmRunCost({
              mode: "ceiling",
              stop: question.stop,
              remainingUsd: question.remainingUsd,
              raiseToUsd: question.raiseToUsd,
              usage: question.usage,
            });
            return outcome.kind === "continue" ? "resume" : "cancel";
          },
          // `P5-T27`: the window's import, through this function's own pipeline.
          imports: {
            pipeline,
            listCollections: () => addon.platform.listCollections(),
          },
        }).host;
  const host: SearchWindowHostApi &
    RelatedSeedHost & {
      readonly related?: RelatedWindowHost;
      readonly recommend?: RecommendWindowHost;
    } = {
    ...published,
    runSearch: async (query: SearchWindowQuery): Promise<void> => {
      await refreshLibraryIndex(logger);
      await published.runSearch(query);
    },
    // FR-13 (`P5-T15`): the related mode's Seed lines.
    loadRelatedSeed: async (seedItemID) => {
      const work = await canonicalWorkOfItemID(seedItemID);
      return work === undefined ? undefined : relatedSeedHeader(work);
    },
    ...(related === undefined ? {} : { related }),
    ...(recommend === undefined ? {} : { recommend }),
  };

  // Captured once, for the reason {@link publishServiceGraph} gives: the
  // teardown must act on the `api` the registration wrote to, not on whichever
  // `Addon` instance the global names when teardown runs.
  const api = addon.api;
  await scope.use({
    description: `the search window host (api.${SEARCH_WINDOW_API_PROPERTY})`,
    register: () => {
      api[SEARCH_WINDOW_API_PROPERTY] = host;
      api.searchWindowDeps = deps;
      // Read off the graph, **not** by calling `deps.listSources()`. Measured
      // 2026-10-07: with that port forced to `undefined` the log line itself
      // threw, the exception came out of `scope.use` and out of `registerUI`,
      // `hooks.onStartup` never set `data.initialized`, and the whole run died
      // with `Internal: Plugin awaiting timeout` — a diagnostic that bricked
      // the plugin instead of describing it. The composition root must survive
      // a missing port; reporting one is what {@link missingDependencies}
      // above is for.
      logger.info("the Search & Import window's host is published", {
        property: SEARCH_WINDOW_API_PROPERTY,
        sources: graph.sources.list().length,
        dependencies: Object.keys(deps).length,
      });
      return SEARCH_WINDOW_API_PROPERTY;
    },
    unregister: () => {
      delete api[SEARCH_WINDOW_API_PROPERTY];
      delete api.searchWindowDeps;
      libraryIndex = undefined;
    },
  });
}

/**
 * Publish FR-13's opener on `addon.api.relatedWindow` (`P5-T15`); on teardown,
 * withdraw it and close the search window still open, in whatever mode it was
 * opened (`docs/08` §5.2's note of 2026-11-02).
 *
 * Registered after {@link publishSearchWindowHost}, so teardown, last in first
 * out, closes the window before its host is withdrawn. A separate registration
 * because that function returns early when the search pipeline is missing, and
 * an inert window must close too.
 */
async function publishSearchWindowCommands(scope: Scope): Promise<void> {
  // Captured once, for the reason {@link publishServiceGraph} gives.
  const api = addon.api;
  await scope.use({
    description: "the search window's related opener and its open window",
    register: () => {
      api.relatedWindow = { open: openRelatedWindowCommand };
      api.recommendWindow = { open: openRecommendWindowCommand };
      return "searchWindowState";
    },
    unregister: () => {
      delete api.relatedWindow;
      delete api.recommendWindow;
      const win = searchWindowState.win;
      searchWindowState.win = undefined;
      if (win !== undefined && win.closed !== true) win.close?.();
    },
  });
}

// ---------------------------------------------------------------------------
// The preference pane's host (`P1-T44`)
// ---------------------------------------------------------------------------

/**
 * The pane's host property on the plugin instance.
 *
 * **This is a module augmentation of `src/addon.ts`'s `PluginApi`, and it is
 * here because that file is outside `P1-T44`'s `Files` list** (`plan/README.md`
 * §5 rule 2). The member belongs in `PluginApi` proper, beside `searchWindow`,
 * with the same doc comment; moving it there is a two-line edit and needs a
 * card. Until then this declaration is what lets `publishPreferencesHost`
 * write the property without a cast, and the document reads it by the same
 * name through {@link PREFERENCES_API_PROPERTY}.
 */
declare module "../addon" {
  interface PluginApi {
    /**
     * The preference pane's privileged host (`src/ui/prefs/preferencesPane.ts`),
     * at the property `PREFERENCES_API_PROPERTY` names. The pane script reads
     * it off `api` by that name; nothing respells it.
     */
    preferences?: PreferencesHostApi;
  }
}

/**
 * Build the pane's host over the graph and publish it where
 * `addon/content/preferences.js` looks for it.
 *
 * The bindings, member by member:
 *
 * | port | bound to |
 * |---|---|
 * | `secrets` | {@link ServiceGraph.secrets} — the tier-1 store; after a failed probe, the tier-2 session store if the user chose it in the degradation dialog (`P3-T03`), otherwise `undefined`, in which case the host refuses every write and the badge warns |
 * | `request` | `src/core/http/client.ts`'s `httpRequest`: the one outbound choke point, with its per-host limiter, D10 guard and redacted log line |
 * | `getBackendPref` | `src/prefs`' typed `getPref("secretBackend")`, the non-secret row `probeAndRecordBackend` wrote (or `adoptSessionSecretStore`, on a tier-2 choice) |
 * | `providerPrefs` | `getPref("llmProvider")`, and `getPref` / `setPref` over each provider's `<provider>.baseUrl` row, named by `PROVIDER_PREF_NAMES` (`P3-T04`); the host validates before it writes |
 * | `hasPluginData` | {@link pluginDatabaseHasData} over the graph's plugin database, for `docs/09` §1.9 item 8's restore notice (`P3-T04`) |
 * | `validateLlm` | {@link validateWithAdapter}: the provider's own registered adapter's `validateCredentials()` (`P3-T14`) |
 * | `validation` | `readValidation` / `recordValidation` in `src/zotero/keychain.ts`: the §8.5 status rows, gated by `redactRecord` (`P3-T14`) |
 * | `modelSuggestions` | {@link preferencesModelSuggestions}: `P3-T13`'s catalogue over the registry, the cache and the price table (`P3-T14`), through the graph's `modelPrices` (item 278(b)) |
 * | `prices` | the graph's `database.prices`, the `user_price` store (`P3-T14` step 5), through `reloadingUserPriceStore` so a change reaches `modelPrices` at once (item 278(b)) |
 * | `settings` | {@link preferencesSettingsPort}: `audio.enabled`, `tts.voice`, `GEMINI_TTS_VOICES` and `tts.linkedFileDir`, for the Report & audio section (`P7-T08`) |
 * | `advanced` | {@link preferencesAdvancedPort}: `logLevel`, the graph's cache counts and the plugin database's location and reveal, for the Advanced section (`P7-T09`) |
 * | `diagnostics` | {@link preferencesDiagnosticsPort}: the diagnostics text over the preferences, the job queue, the log ring and the cache, and its save and copy (`P7-T13`) |
 * | `policyNotes` | `POLICY_NOTES` from `src/llm/shared/policyNotes.ts`, the dated provider-policy lines of the Privacy section (`P7-T17`), handed over as data because `ui/` may not import `llm/` |
 * | `clock` | the graph's clock, for the Semantic Scholar retry delay and the `checkedAt` stamp |
 * | `logger` | a child of the graph's redacting logger |
 *
 * Nothing here can reach a key: the host asks the store for one only inside
 * its Test call, to build one request, and the store it asks is the shipped
 * `src/zotero/keychain.ts` through the `SecretStore` port.
 */
/**
 * `P7-T08`: the pane host's {@link SettingsPort} — the Report & audio
 * section's reads (`audio.enabled`, `tts.voice`, `tts.linkedFileDir`, and
 * `GEMINI_TTS_VOICES`, the documented default voice list) and its one write
 * (`tts.linkedFileDir`, after the same folder test the audio delivery uses).
 * Bound here because `src/ui` may not import `src/tts` or `src/zotero`.
 * Caller: {@link publishPreferencesHost}.
 */
export function preferencesSettingsPort(): SettingsPort {
  let attachments: ReturnType<typeof createZoteroAudioAttachments> | undefined;
  return {
    readAudioEnabled: () => getPref("audioEnabled"),
    // The documented default list, names only: no call (docs/08 §7.3's note
    // of 2026-11-17). A voice's name is shown as it is (docs/08 §10.3).
    voices: GEMINI_TTS_VOICES.map((voice) => ({
      id: voice.id,
      label: voice.displayName,
    })),
    readVoice: () => getPref("ttsVoice"),
    getLinkedFolder: () => getPref("ttsLinkedFileDir"),
    setLinkedFolder: (path) => {
      setPref("ttsLinkedFileDir", path);
    },
    // resolveLinkedFolder's test (src/pipeline/audioReport/deliver.ts), over
    // the same Zotero port, built on first use.
    isUsableFolder: async (path) => {
      attachments ??= createZoteroAudioAttachments();
      return (
        path.trim() !== "" &&
        !attachments.isTemporaryFolder(path) &&
        (await attachments.folderExists(path))
      );
    },
  };
}

/**
 * `P7-T09`: the Advanced section's {@link AdvancedPort}. Caller:
 * {@link publishPreferencesHost}, which hands it to `createPreferencesHost`.
 *
 * - `logLevel` through `getPref` / `setPref`, which is the only row it writes
 *   (`docs/07` §8.5, Diagnostics: no `debug` row; `logRequestBodies` stays as
 *   it is). The logger reads the level live (`container.ts`'s `level`
 *   getter), so the change takes effect without a restart.
 * - The cache counts are `graph.cache.stats()`, the instance every job uses;
 *   the location is `pluginDatabasePath()`. Both, and the reveal, answer "not
 *   open" when `graph.database.ready` resolves to no database.
 */
export function preferencesAdvancedPort(
  graph: Pick<ServiceGraph, "cache" | "database">,
): AdvancedPort {
  const open = async (): Promise<boolean> =>
    (await graph.database.ready) !== undefined;
  return {
    readLogLevel: () => getPref("logLevel"),
    writeLogLevel: (level) => {
      setPref("logLevel", level);
    },
    cacheStats: async () => ((await open()) ? graph.cache.stats() : undefined),
    databasePath: async () =>
      (await open()) ? pluginDatabasePath() : undefined,
    revealDatabase: async () => {
      if (!(await open())) return false;
      await revealPluginDatabase();
      return true;
    },
  };
}

/**
 * The ports `src/core/dataReset.ts` runs over: the plugin's own open
 * connection, its cache and the report Markdown files; `undefined` when the
 * plugin database is not open.
 */
async function openDataResetPorts(
  graph: Pick<ServiceGraph, "cache" | "database">,
): Promise<DataResetPorts | undefined> {
  const open = await graph.database.ready;
  return open === undefined
    ? undefined
    : {
        connection: open.connection,
        cache: graph.cache,
        reportFiles: createReportMarkdownFiles(),
      };
}

/**
 * `P7-T11`: "Remove all Research Helper content" (`plan/00` §6 item 380,
 * decision 2). `find` reads the audio keys the stored reports name, then
 * every user and group library (`findAllPluginContent`), then the database's
 * counts, and writes nothing; `remove` moves what was found to Zotero's
 * trash, each item checked again (`trashPluginContent`), then deletes the
 * stored data, keeping the rows of jobs that have not ended, as the pane's
 * "Delete all plugin data" does. A library the user cannot edit is counted
 * apart and named, never written. Library names and folders reach the
 * confirmation only; nothing here logs one. Never run from `uninstall()`.
 */
export function preferencesContentRemovalPort(
  graph: Pick<ServiceGraph, "cache" | "database">,
): ContentRemovalPort {
  return {
    find: async () => {
      const ports = await openDataResetPorts(graph);
      if (ports === undefined) return undefined;
      const audio = await reportAudioKeys(ports.connection);
      const content = await findAllPluginContent(
        pluginContentLibraryIDs(),
        audio,
      );
      const counts = await countData(ports, "all");
      let generated = 0;
      let provenance = 0;
      let audioCount = 0;
      const libraries: string[] = [];
      const skipped: string[] = [];
      const folders = new Set<string>();
      for (const library of content.libraries) {
        const held =
          library.generatedNoteIDs.length +
          library.provenanceNoteIDs.length +
          library.audioAttachmentIDs.length;
        if (held === 0) continue;
        if (!library.editable) {
          skipped.push(library.name);
          continue;
        }
        libraries.push(library.name);
        generated += library.generatedNoteIDs.length;
        provenance += library.provenanceNoteIDs.length;
        audioCount += library.audioAttachmentIDs.length;
        for (const folder of library.linkedFolders) folders.add(folder);
      }
      const summary: ContentSummary = {
        generated,
        provenance,
        audio: audioCount,
        records: counts.rows + counts.entries,
        libraries,
        skipped,
        linkedFolders: [...folders],
      };
      return { summary, plan: content };
    },
    remove: async (plan) => {
      const ports = await openDataResetPorts(graph);
      if (ports === undefined) return undefined;
      const moved = await trashPluginContent(plan as PluginContent);
      const deleted = await deleteAllPluginData(ports, {
        keepActiveJobs: true,
      });
      return { moved, records: deleted.rows + deleted.entries };
    },
  };
}

/**
 * `P7-T10`: the pane's stored-data actions, over the plugin's own open
 * connection and its cache (`src/core/dataReset.ts`), and "Reset to defaults"
 * over the preference store. The confirmation is Zotero's modal prompt over
 * the preferences window, as `removeGeneratedNotesCommand`'s is. Nothing
 * here logs a path, a value or a count beyond what the host logs.
 */
export function preferencesDataResetPort(
  graph: Pick<ServiceGraph, "cache" | "database" | "prefs">,
): DataResetPort {
  const ports = () => openDataResetPorts(graph);
  return {
    count: async (kind) => {
      const bound = await ports();
      return bound === undefined ? undefined : countData(bound, kind);
    },
    clear: async (kind) => {
      const bound = await ports();
      return bound === undefined ? undefined : clearData(bound, kind);
    },
    resetPreferences: () => resetPreferences(graph.prefs, PREFS),
    confirm: async (line, parent) => {
      const l10n = new Localization([MAIN_WINDOW_FTL]);
      const title =
        (await formatValue(l10n, PREFERENCES_L10N.dataConfirmTitle)) ??
        "Research Helper";
      // A FluentLine names one id of a union, so its arguments cannot be
      // typed per message here; the host built them for that id.
      const message = await (
        formatValue as unknown as (
          formatter: Parameters<typeof formatValue>[0],
          id: string,
          args?: FluentLine["args"],
        ) => Promise<string | undefined>
      )(l10n, line.id, line.args);
      // No message, no question: a confirmation that cannot say what it
      // removes is not asked.
      if (message === undefined) return false;
      return Services.prompt.confirm(
        parent as mozIDOMWindowProxy,
        title,
        message,
      );
    },
  };
}

/**
 * Preferences whose values the diagnostics text shows only as "set" or "not
 * set": every `secret: true` row (none ships; the schema forbids one with a
 * writer), the contact address (the user's email, which may appear only in
 * the `User-Agent`), and the linked audio folder (a local path, never logged).
 */
const DIAGNOSTICS_WITHHELD_PREFS: ReadonlySet<PrefName> = new Set<PrefName>([
  "contactEmail",
  "ttsLinkedFileDir",
]);

/**
 * `P7-T13`: the pane's diagnostics port. Reads the platform through
 * `src/zotero/diagnosticsPlatform.ts`, the preferences through `getPref`, the
 * jobs through the queue and the cache through its stats, and hands
 * `buildDiagnostics` plain data. Nothing here logs a path or a value.
 */
export function preferencesDiagnosticsPort(
  graph: Pick<ServiceGraph, "cache" | "database" | "jobs">,
  ring: LogRing,
): DiagnosticsPort {
  return {
    text: async () => {
      const environment = zoteroEnvironment();
      const settings = PREF_NAMES.map((name) => {
        const def = PREFS[name] as { readonly secret?: boolean };
        return {
          name: PREFS[name].key,
          value: getPref(name),
          withheld: def.secret === true || DIAGNOSTICS_WITHHELD_PREFS.has(name),
        };
      });
      const keysPresent: Record<string, boolean> = {};
      for (const name of PREF_NAMES) {
        if (name.endsWith("KeyPresent")) {
          keysPresent[PREFS[name].key] = getPref(name) === true;
        }
      }
      let jobs: readonly DiagnosticsJob[];
      try {
        jobs = (await graph.jobs.list({})).map(diagnosticsJob);
      } catch {
        jobs = [];
      }
      let cache: DiagnosticsCache | undefined;
      try {
        cache =
          (await graph.database.ready) === undefined
            ? undefined
            : await graph.cache.stats();
      } catch {
        cache = undefined;
      }
      const withheldValues = [
        String(getPref("contactEmail") ?? ""),
        String(getPref("ttsLinkedFileDir") ?? ""),
        environment.dataDirectory,
      ];
      return buildDiagnostics({
        generatedAtEpochMs: Date.now(),
        pluginVersion: version,
        zoteroVersion: environment.zoteroVersion,
        os: environment.os,
        locale: environment.locale,
        settings,
        keysPresent,
        jobs,
        logLines: ring.lines(),
        errors: pluginErrorLines(LOG_PREFIX),
        cache,
        withheldValues,
        requestBodiesLogged: getPref("logRequestBodies") === true,
      });
    },
    save: (path, text) => writeDiagnosticsFile(path, text),
    copy: (text) => copyDiagnosticsText(text),
  };
}

async function publishPreferencesHost(
  scope: Scope,
  graph: ServiceGraph,
  ring: LogRing,
): Promise<void> {
  const host = createPreferencesHost({
    secrets: graph.secrets,
    request: httpRequest,
    getBackendPref: () => getPref("secretBackend"),
    providerPrefs: {
      getActiveProvider: () => getPref("llmProvider"),
      getBaseUrl: (provider) => getPref(PROVIDER_PREF_NAMES[provider].baseUrl),
      setBaseUrl: (provider, value) => {
        setPref(PROVIDER_PREF_NAMES[provider].baseUrl, value);
      },
    },
    hasPluginData: () => pluginDatabaseHasData(graph.database),
    // P3-T14: each LLM key is tested by its own adapter, over its own host.
    validateLlm: (provider) => validateWithAdapter(graph, provider),
    validation: { read: readValidation, record: recordValidation },
    modelSuggestions: preferencesModelSuggestions(graph),
    prices: reloadingUserPriceStore(graph.database.prices, graph.modelPrices),
    settings: preferencesSettingsPort(),
    advanced: preferencesAdvancedPort(graph),
    policyNotes: POLICY_NOTES,
    diagnostics: preferencesDiagnosticsPort(graph, ring),
    dataReset: preferencesDataResetPort(graph),
    contentRemoval: preferencesContentRemovalPort(graph),
    clock: graph.clock,
    logger: graph.logger.child({ surface: "preferences" }),
  });
  // Captured once, for the reason {@link publishServiceGraph} gives.
  const api = addon.api;
  await scope.use({
    description: `the preference pane host (api.${PREFERENCES_API_PROPERTY})`,
    register: () => {
      api[PREFERENCES_API_PROPERTY] = host;
      return PREFERENCES_API_PROPERTY;
    },
    unregister: () => {
      delete api[PREFERENCES_API_PROPERTY];
    },
  });
}

/**
 * `P3-T14`: the pane's LLM Test — `provider`'s own registered adapter's
 * `validateCredentials()` (`docs/07` §4.3), so the key goes only to that
 * provider's host, through the shared `HttpClient` the adapter was built
 * with. The adapter reads the key itself; nothing here sees it. The token
 * is never cancelled: a Test is one bounded request.
 */
function validateWithAdapter(
  graph: ServiceGraph,
  provider: ProviderId,
): Promise<LlmKeyCheck> {
  const adapter = graph.llm.registry.get(provider);
  if (adapter === undefined) {
    return Promise.reject(
      new Error(`[research-helper] no adapter registered for ${provider}`),
    );
  }
  const source = createCancellationTokenSource();
  return adapter.validateCredentials({ token: source.token });
}

/**
 * `P3-T14` step 5: the model fields' suggestions, from `P3-T13`'s catalogue
 * over the graph's registry, cache and price table. The catalogue caches each
 * list for 24 hours, so a pane opened twice in a day sends nothing the second
 * time. OpenRouter's public catalogue comes from its adapter's
 * `listCatalogue`, which sends no key.
 *
 * *(Updated 2026-10-23, `plan/00` §6 item 278(b).)* The catalogue is the
 * graph's one, inside {@link ServiceGraph.modelPrices}: fetching the
 * suggestions also refreshes the prices the spend guard reserves with, so the
 * pane builds no catalogue of its own.
 */
function preferencesModelSuggestions(
  graph: ServiceGraph,
): () => Promise<ModelSuggestions> {
  return async () => {
    const snapshot = await graph.modelPrices.refresh({
      token: createCancellationTokenSource().token,
    });
    return {
      providers: LLM_CREDENTIALS.map(({ provider }) => ({
        provider,
        models: modelsFor(snapshot, provider).map((model) => model.id),
      })),
      asOfEpochMs: snapshot.asOfEpochMs,
      stale: snapshot.stale,
    };
  };
}

/**
 * Whether the plugin database already holds a row in any of its tables other
 * than `schema_version` — `docs/09` §1.9 item 8's sign that this Zotero data
 * folder has been used with the plugin before (`P3-T04` step 4). The tables
 * are read from `sqlite_master` rather than listed, so a table a later
 * migration adds counts without an edit here.
 *
 * `false` when there is no database this run. Reads only whether a row
 * exists, never what it holds.
 *
 * The `LIKE` pattern is bound: the connection's `Sqlite.sys.mjs` refuses a
 * `LIKE` followed by a literal ("Please enter a LIKE clause with bindings"),
 * so before 2026-11-17 this query threw in Zotero, the pane's catch read it
 * as "no data", and the restore notice could not show (`plan/00` §6 item
 * 398(i); `test/unit/bootstrap/sqlLikeBindings.test.ts`).
 */
async function pluginDatabaseHasData(
  database: PluginDatabase,
): Promise<boolean> {
  const open = await database.ready;
  if (open === undefined) return false;
  const result: unknown = await open.connection.queryAsync(
    "SELECT name FROM sqlite_master WHERE type = 'table' " +
      "AND name NOT LIKE ? AND name <> 'schema_version'",
    ["sqlite_%"],
  );
  const tables = Array.isArray(result)
    ? (result as readonly { name?: unknown }[])
    : [];
  for (const row of tables) {
    if (typeof row.name !== "string") continue;
    // The name comes from sqlite_master, not from input; quoted all the same.
    const quoted = `"${row.name.replaceAll('"', '""')}"`;
    const any: unknown = await open.connection.valueQueryAsync(
      `SELECT EXISTS (SELECT 1 FROM ${quoted})`,
    );
    if (Number(any) === 1) return true;
  }
  return false;
}

/**
 * `docs/09` §1.7's degradation dialog (`P3-T03`), raised over the Zotero main
 * window. `installServices` calls this only after the keystore probe failed,
 * and installs no store until it resolves.
 *
 * **Why the window comes from `Services.wm` here.** `src/ui/**` may not touch
 * the platform, and this file may not reference the `Zotero` global
 * (`research-helper/zotero-global`), so `Zotero.getMainWindow()` is out of
 * reach — the same limit {@link searchWindowDeps} records for the file chooser.
 * `Services.wm.getMostRecentWindow("navigator:browser")` is the call
 * `Zotero.getMainWindow()` itself makes; `hooks.ts` awaits
 * `Zotero.uiReadyPromise` before `registerUI` runs, so a main window exists.
 * The result is narrowed by the one member used, as `registerMenus.ts`
 * narrows its menu's window.
 *
 * @returns the user's choice
 * @throws when no main window can raise the dialog; `installServices` then
 *   continues with no stored keys rather than choosing a tier for the user
 */
function chooseSecretBackend(): Promise<SecretBackendChoice> {
  const win: unknown = Services.wm.getMostRecentWindow("navigator:browser");
  if (
    typeof win !== "object" ||
    win === null ||
    typeof (win as Partial<SecretBackendDialogHost>).openDialog !== "function"
  ) {
    return Promise.reject(
      new Error(
        "[research-helper] no Zotero main window to raise the key-storage " +
          "dialog over",
      ),
    );
  }
  return openSecretBackendDialog(win as SecretBackendDialogHost);
}

/**
 * `P3-T16`: this plugin lifetime's one session spend counter (`docs/06`
 * §11.4). Held in memory only and never written anywhere: the next Zotero
 * start evaluates this module again and the count is zero, which is the rule
 * "resets when Zotero restarts". The Usage readout reads it; `P3-T35` hands
 * the same counter to every job's `createBudgetGuard` (reported: the card
 * that wires the context owns that call).
 */
const sessionSpend: SessionSpendCounter = createSessionSpendCounter();

/** The counter every job's budget guard must share (`P3-T35`). */
export function getSessionSpendCounter(): SessionSpendCounter {
  return sessionSpend;
}

/**
 * The application's locale, for `Intl` (`docs/08` §10.3). `Zotero.locale` is
 * out of reach here (`research-helper/zotero-global`); `Services.locale` is
 * what it reads. Falls back to `en-US`, the bundle every id resolves in.
 */
function appLocale(): string {
  try {
    const tag = Services.locale.appLocaleAsBCP47;
    return typeof tag === "string" && tag !== "" ? tag : "en-US";
  } catch {
    return "en-US";
  }
}

/**
 * `P3-T16` step 2: the cost dialog the summarize pipeline calls before its
 * first paid call, and again when a spend ceiling pauses it (`P3-T29` passes
 * this to its pipeline). Raised over the Zotero main window, for the reason
 * {@link chooseSecretBackend} gives.
 *
 * @param input - the pre-run estimate and disclosure, or the ceiling stop
 * @returns what the user chose; rejects when no window can show the number,
 *   and the caller then runs nothing
 */
export function confirmRunCost(
  input: CostDialogInput,
): Promise<CostDialogOutcome> {
  return openOverMainWindow(buildCostDialogModel(input, appLocale()));
}

/**
 * `P6-T17`: the cost dialog for one of an audio run's two moments (`P6-T15`'s
 * `buildAudioDialogModel`, with the tier question when it asks it), raised as
 * {@link confirmRunCost} raises its own.
 *
 * @param input - the moment's figures and disclosure
 * @returns what the user chose; rejects when no window can show the number
 */
function confirmAudioCost(input: AudioDialogInput): Promise<CostDialogOutcome> {
  return openOverMainWindow(buildAudioDialogModel(input, appLocale()));
}

/** Open the cost dialog over the Zotero main window, or reject. */
function openOverMainWindow(
  model: CostDialogModel,
): Promise<CostDialogOutcome> {
  const win: unknown = Services.wm.getMostRecentWindow("navigator:browser");
  if (
    typeof win !== "object" ||
    win === null ||
    typeof (win as Partial<CostDialogHost>).openDialog !== "function"
  ) {
    return Promise.reject(
      new Error(
        "[research-helper] no Zotero main window to raise the cost dialog over",
      ),
    );
  }
  return openCostConfirmDialog(win as CostDialogHost, model);
}

declare module "../addon" {
  interface PluginApi {
    /**
     * The preference pane's Usage host (`P3-T16` step 6), at the property
     * `USAGE_API_PROPERTY` names; `addon/content/preferences.js` reads it.
     */
    usage?: UsageHostApi;
  }
}

/**
 * Publish the Usage host where `addon/content/preferences.js` looks for it:
 * the session counter's totals and `run.maxSessionSpendCents`, read each time
 * the pane asks.
 */
async function publishUsageHost(scope: Scope): Promise<void> {
  const host = createUsageHost({
    session: () => sessionSpend.totals,
    sessionLimitCents: () => getPref("runMaxSessionSpendCents"),
    locale: appLocale,
  });
  // Captured once, for the reason {@link publishServiceGraph} gives.
  const api = addon.api;
  await scope.use({
    description: `the Usage readout host (api.${USAGE_API_PROPERTY})`,
    register: () => {
      api[USAGE_API_PROPERTY] = host;
      return USAGE_API_PROPERTY;
    },
    unregister: () => {
      delete api[USAGE_API_PROPERTY];
    },
  });
}

// ---------------------------------------------------------------------------
// The item pane's AI summary section (`P3-T28`)
// ---------------------------------------------------------------------------

declare module "../addon" {
  interface PluginApi {
    /**
     * The item-pane summary section's host (`P3-T28`): the object the section
     * reads on every render, published so an integration spec — bundled
     * separately — can reach the same instance.
     */
    summarySection?: SummarySectionHost;
  }
}

/**
 * The item pane's one-item run over the graph (`runItemSummary`; owner,
 * `plan/00` §6 item 303(a)): the same pipeline, job contexts, record and
 * confirmation as the summarize window's session ({@link createSummarizeSession}),
 * over no collection — no "don't ask again" record — and under the strictest
 * privacy mode of the item's collections and the global setting
 * (`collectionsOfItem`, passed to `openJob` as `itemCollections`; owner,
 * `plan/00` §6 item 305(a); was the global mode alone, item 278(c)).
 */
function itemSummaryDeps(graph: ServiceGraph): ItemSummaryDeps {
  return {
    pipeline: graph.pipelines.get("summarize") as SummarizePipeline | undefined,
    collectionsOf: collectionsOfItem,
    openJob: async (record, token, itemCollections) => {
      const job = await graph.pipelineContext.openJob({
        pipelineId: "summarize",
        token,
        ...(record !== undefined && { record }),
        itemCollections,
        openOn: "completion",
      });
      return {
        context: job.context,
        finish: async (outcome) => {
          try {
            if (outcome !== undefined) job.progress.reporter.done(outcome);
            await job.checkpoints?.flush().catch(() => undefined);
          } finally {
            job.dispose();
          }
        },
      };
    },
    enqueue: (input, disclosure) =>
      graph.jobs.enqueue(
        "summarize",
        disclosure === undefined
          ? input
          : withEgressLog(input, egressLogEntry(disclosure, graph.clock.now())),
        {
          priority: "normal",
          exclusivityKey: summarizeExclusivityKey(input),
          libraryID: input.libraryID,
          inputVersion: SUMMARIZE_INPUT_VERSION,
        },
      ),
    confirm: summarizeConfirmDeps(graph),
    askCeiling: async (question) => {
      const outcome = await confirmRunCost({
        mode: "ceiling",
        stop: question.stop,
        remainingUsd: question.remainingUsd,
        raiseToUsd: question.raiseToUsd,
        usage: question.usage,
      });
      return outcome.kind === "continue" ? "resume" : "cancel";
    },
  };
}

/**
 * "Save as child note" wrote nothing: say why in a `Zotero.ProgressWindow`
 * popup (`docs/08` §8.1's mechanism for a short action; item 303(b)).
 */
async function showNoteNotWritten(
  reason: "exists" | "read-only",
): Promise<void> {
  const text = await formatValue(
    new Localization([MAIN_WINDOW_FTL]),
    SUMMARY_RESULT_L10N.noteNotWritten,
    { reason },
  );
  if (text === undefined) {
    throw new Error("[research-helper] the note line has no text");
  }
  const popup = openZoteroProgressWindow();
  popup.changeHeadline(text);
  popup.show();
  popup.startCloseTimer(8000);
}

/**
 * Register the item pane's AI summary section (`docs/08` §3) and its
 * delete/trash observer, each through its `src/zotero/registrations.ts`
 * factory, after publishing the host both read.
 *
 * | host member | bound to |
 * |---|---|
 * | `isConfigured` | the registry's `isConfigured` for the active provider — the presence flag, never the key (D5) |
 * | `autoSummarize` | `getPref("autoSummarize")`, read per render; ships `false` (`docs/07` §8.5) |
 * | `load` | the newest `summary` row of `fromZoteroItem(item).workKey`, through `graph.database.summaries()` — the store `P3-T29` constructs in `installPluginDatabase`; no request |
 * | `generate` | a one-item run of the summarize pipeline: {@link itemSummaryDeps} under `runItemSummary` (owner, `plan/00` §6 item 303(a)); `regenerate` → `resummarize`; `bypassCache` (Regenerate only) → `SummarizeInput.bypassCache` (item 305(c)) |
 * | `saveAsNote` | `saveSummaryNoteOnce` (`src/zotero/notes.ts`; item 303(b)): no second note; the written note's key stored on the row; otherwise {@link showNoteNotWritten} |
 * | `onError` | `reportError`, the debug log |
 * | `locale` | {@link appLocale} |
 *
 * **Generate runs the summarize job for the one item** (decided 2026-10-29,
 * owner, `plan/00` §6 item 303(a); `docs/08` §3.2's and §3.3's notes of that
 * date), so the pre-run estimate and confirmation (`P3-T16`), the first-job
 * egress notice (`P3-T15`), acquisition, the `llm` pool, the spending
 * ceilings and cancel apply to it as to a collection run. Its progress is the
 * section's loading state; its questions are the cost dialog's.
 *
 * Teardown is last-in-first-out: the section goes first, then the observer,
 * then the host.
 */
async function publishSummarySection(
  scope: Scope,
  graph: ServiceGraph,
): Promise<void> {
  const logger = graph.logger.child({ surface: "itemPane" });
  const host: SummarySectionHost = {
    isConfigured: () =>
      graph.llm.registry.isConfigured(graph.llm.registry.activeProviderId()),
    autoSummarize: () => getPref("autoSummarize"),
    load: async (item) => {
      // `P3-T29`'s store on the one connection (`installPluginDatabase`):
      // tracked, so teardown waits for a read in flight.
      const store = await graph.database.summaries();
      if (store === undefined) return undefined;
      const workKey = fromZoteroItem(item).workKey;
      const rows = await store.listForWork(workKey);
      return rows[0];
    },
    generate: (item, { regenerate, bypassCache }) => {
      const source = createCancellationTokenSource();
      const done = runItemSummary(
        itemSummaryDeps(graph),
        {
          libraryID: item.libraryID,
          itemKey: item.key,
          regenerate,
          // Regenerate's bypass (item 305(c)); Retry never sets it.
          ...(bypassCache === true && { bypassCache: true }),
        },
        source.token,
      ).finally(() => {
        source.dispose();
      });
      return {
        done,
        cancel: () => {
          source.cancel({ kind: "user" });
        },
      };
    },
    saveAsNote: async (item, stored) => {
      const store = await graph.database.summaries();
      if (store === undefined) {
        throw new ConfigurationError(
          "the plugin database is not open, so no note was written",
        );
      }
      const outcome = await saveSummaryNoteOnce(
        {
          libraryID: item.libraryID,
          parentItemKey: item.key,
          stored,
          sourceName: undefined,
        },
        { put: (row) => store.put(row) },
      );
      if (outcome.kind !== "written") await showNoteNotWritten(outcome.kind);
    },
    onError: (message, error) => {
      logger.warn(message, {
        reason: error instanceof Error ? error.name : typeof error,
      });
      reportError(message, error);
    },
    locale: appLocale,
  };

  // Captured once, for the reason {@link publishServiceGraph} gives.
  const api = addon.api;
  await scope.use({
    description: "the item-pane summary section host (api.summarySection)",
    register: () => {
      api.summarySection = host;
      return "api.summarySection";
    },
    unregister: () => {
      delete api.summarySection;
    },
  });
  await notifierRegistration(SUMMARY_NOTIFIER_DESCRIPTION, {
    notify: summaryInvalidationObserver({
      workKeyOf: workKeyOfItemID,
      invalidateByTag: (tag) => graph.cache.invalidateByTag(tag),
      onError: host.onError,
    }),
    types: ["item"],
    id: SUMMARY_NOTIFIER_ID,
  })(scope);
  await itemPaneSectionRegistration(
    SUMMARY_SECTION_DESCRIPTION,
    summarySectionOptions(config.addonID, host),
  )(scope);
}

// ---------------------------------------------------------------------------
// The summarize window and the removal command (`P3-T29`)
// ---------------------------------------------------------------------------

/**
 * The graph the two collection commands run over: set by
 * {@link publishSummarizeCommands}, cleared in its teardown. Module state, as
 * {@link provenanceState} is, because `SEARCH_MENU_COMMANDS` is built before
 * any graph exists.
 */
const summarizeState: {
  graph: ServiceGraph | undefined;
  /**
   * Every summarize window this instance opened that is still open, with the
   * session it was opened with, closed at shutdown as the report window's are
   * (owner, `plan/00` §6 item 307(e)).
   *
   * *Changed 2026-11-18 (`P7-T39`, owner, `plan/00` §6 item 403(a)):* a
   * window is forgotten when its session's `closed()` runs, not at the next
   * open; the handle kept until then held the closed window alive. The session
   * is the key's check: a named window opened again for the same collection
   * keeps its handle, and the old document's `closed()` must not drop it.
   */
  readonly windows: Map<SummarizeWindowHandle, SummarizeWindowSession>;
} = { graph: undefined, windows: new Map() };

/** The menu's "Summarize All Papers in Collection": open its window. */
function openSummarizeWindowCommand(
  host: Parameters<NonNullable<SearchMenuCommands["openSummarizeWindow"]>>[0],
  collectionID: number,
): SummarizeWindowHandle {
  const graph = summarizeState.graph;
  if (graph === undefined) {
    throw new Error("[research-helper] the summarize window has no services");
  }
  let win: SummarizeWindowHandle | undefined;
  const session = createSummarizeSession(graph, collectionID, () => {
    // A window the user closed is forgotten when it closes (item 307(e);
    // `P7-T39`).
    if (win !== undefined && summarizeState.windows.get(win) === session) {
      summarizeState.windows.delete(win);
    }
    win = undefined;
  });
  win = openSummarizeWindow(host, collectionID, session);
  summarizeState.windows.set(win, session);
  return win;
}

/**
 * FR-20's "Remove Generated Notes from Collection…": count, ask with the
 * exact count (`Services.prompt.confirm`, over the window the menu was clicked
 * in), move to the trash, say how many. Nothing is asked or moved at 0.
 */
async function removeGeneratedNotesCommand(
  host: Parameters<NonNullable<SearchMenuCommands["removeGeneratedNotes"]>>[0],
  collectionID: number,
): Promise<void> {
  const l10n = new Localization([MAIN_WINDOW_FTL]);
  const title =
    (await formatValue(l10n, REMOVE_NOTES_L10N.title)) ?? "Research Helper";
  const parent = host as unknown as mozIDOMWindowProxy;
  const result = await removeGeneratedNotes(
    collectionID,
    async (count, collection) => {
      const message = await formatValue(l10n, REMOVE_NOTES_L10N.confirm, {
        count,
        collection,
      });
      return Services.prompt.confirm(parent, title, message ?? title);
    },
  );
  if (result.found === 0) {
    const none = await formatValue(l10n, REMOVE_NOTES_L10N.none, {
      collection: result.collectionName,
    });
    Services.prompt.alert(parent, title, none ?? title);
  } else if (result.confirmed) {
    const done = await formatValue(l10n, REMOVE_NOTES_L10N.done, {
      count: result.moved,
    });
    Services.prompt.alert(parent, title, done ?? title);
  }
}

/** The run's confirmation over the graph (`P3-T16`'s dialog; item 292(f)). */
function summarizeConfirmDeps(graph: ServiceGraph): SummarizeConfirmDeps {
  return {
    readRoutine: async (collection) =>
      readCollectionPrivacySettings(
        await graph.collectionSettings.get(
          collection.libraryID,
          collection.collectionKey,
        ),
      ).routineConfirmation,
    writeRoutine: (collection, record) =>
      writeCollectionPrivacySettings(graph.collectionSettings, collection, {
        routineConfirmation: record,
      }),
    openDialog: confirmRunCost,
    settle: (disclosure, outcome) => {
      settleDisclosure(disclosure, outcome);
    },
    confirmAboveCents: () => getPref("summaryConfirmAboveCents"),
    fullTextAutoMaxPapers: () => getPref("summaryFullTextAutoMaxPapers"),
    providerName: (disclosure) =>
      providerDisplayName(graph, disclosure.providerId),
    locale: appLocale,
  };
}

/**
 * A paused run's question: the money one in the cost dialog's ceiling mode,
 * the others in the window (`P3-T29`; owner, item 265(a)).
 */
async function askPausedRun(
  graph: ServiceGraph,
  sink: SummarizeWindowSink,
  question: SummarizeQuestion,
): Promise<"resume" | "cancel"> {
  if (question.reason === "budget-stop") {
    const outcome = await confirmRunCost({
      mode: "ceiling",
      stop: question.stop,
      remainingUsd: question.remainingUsd,
      raiseToUsd: question.raiseToUsd,
      usage: question.usage,
    });
    return outcome.kind === "continue" ? "resume" : "cancel";
  }
  if (question.reason === "credential-required") {
    return sink.ask(
      pauseQuestionLine({
        reason: "credential-required",
        provider: await providerDisplayName(graph, question.providerId),
      }),
    );
  }
  return sink.ask(
    pauseQuestionLine({
      reason:
        question.reason === "wall-clock-budget" ? "wall-clock-budget" : "other",
      done: question.done,
      total: question.total,
      minutes: question.minutes,
    }),
  );
}

/** A view of a collection before any run. */
function idleView(
  name: string,
  total: number,
  notesWritable: boolean,
): SummarizeRunView {
  return {
    stage: "loading",
    collectionName: name,
    total,
    toSummarize: 0,
    settled: 0,
    rows: [],
    counts: {
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
    },
    notesWritable,
  };
}

/**
 * One summarize window's privileged side (`P3-T29`;
 * `src/ui/dialogs/summarizeDialog.ts`'s `SummarizeWindowSession`).
 *
 * `start` runs the pipeline's two halves (`docs/07` §12.3's note of
 * 2026-10-29, item 1): `prepare` in a job context with no record; then, only
 * when it says "run", the record is enqueued with the confirmed disclosure's
 * egress log (`docs/09` §3.6 item 4) and `execute` runs in its context. Cancel
 * — or the window closing — cancels the run's token; nothing is rolled back.
 * The export path is used once and never kept or logged (`docs/09` §2.2).
 *
 * @param onClosed - run after `closed()` has cancelled the run, so the opener
 *   forgets the window (`P7-T39`)
 */
function createSummarizeSession(
  graph: ServiceGraph,
  collectionID: number,
  onClosed: () => void,
): SummarizeWindowSession {
  const logger = graph.logger.child({ surface: "summarizeWindow" });
  let running: CancellationTokenSource | undefined;
  let summaries: readonly SummaryRef[] = [];
  let collectionName = "";
  return {
    describe() {
      const header = describeCollectionForSummary(collectionID);
      collectionName = header?.name ?? "";
      const model = buildSummarizeWindowModel(
        idleView(
          collectionName,
          header?.regularItems ?? 0,
          header?.editable === true,
        ),
        { running: false },
      );
      return Promise.resolve({
        model: { ...model, stage: undefined },
        writeNotesDefault: getPref("reportPerPaperNotes"),
      });
    },

    async start(options, sink) {
      if (running !== undefined) return;
      const header = describeCollectionForSummary(collectionID);
      const pipeline = graph.pipelines.get("summarize") as
        SummarizePipeline | undefined;
      const source = createCancellationTokenSource();
      running = source;
      let view = idleView(
        header?.name ?? "",
        header?.regularItems ?? 0,
        header?.editable === true,
      );
      let notice: FluentLine | undefined;
      let eta: number | undefined;
      // `P7-T33` (`plan/00` §6 item 393): a paper or the run failed offline.
      let offline = false;
      const draw = (): void => {
        sink.render(
          buildSummarizeWindowModel(view, {
            running: true,
            etaSeconds: eta,
            notice,
            offline,
          }),
        );
      };
      const surface: SummarizeSurface = {
        update: (next) => {
          view = next;
          draw();
        },
        confirm: async (request) => {
          const result = await confirmSummarizeRun(
            summarizeConfirmDeps(graph),
            request,
          );
          notice = result.notice;
          draw();
          return result.answer;
        },
        ask: (question) => askPausedRun(graph, sink, question),
        itemFailed: (_itemKey, error) => {
          if (!offline && isOfflineFailure(error)) {
            offline = true;
            draw();
          }
        },
      };
      let outcome: SummarizeWindowOutcome;
      let stoppedAt: number | undefined;
      try {
        if (header === undefined || pipeline === undefined) {
          throw new ConfigurationError(
            "the collection or the summarize pipeline is not available",
          );
        }
        collectionName = header.name;
        const collection = {
          libraryID: header.libraryID,
          collectionKey: header.collectionKey,
        };
        const input: SummarizeInput = {
          ...collection,
          resummarize: options.resummarize,
          writeNotes: options.writeNotes && header.editable,
        };
        const before = await graph.pipelineContext.openJob({
          pipelineId: "summarize",
          token: source.token,
          collection,
          openOn: "completion",
        });
        let prepared;
        try {
          prepared = await pipeline.prepare(input, before.context, surface);
        } finally {
          before.dispose();
        }
        summaries = prepared.state.summaries;
        if (prepared.status === "declined") {
          outcome = "declined";
        } else if (
          prepared.state.planned.length === 0 &&
          prepared.state.fromStore.length === 0
        ) {
          outcome =
            prepared.state.counts.existing > 0 ? "nothing" : "succeeded";
        } else {
          const record = await graph.jobs.enqueue(
            "summarize",
            prepared.disclosure === undefined
              ? input
              : withEgressLog(
                  input,
                  egressLogEntry(prepared.disclosure, graph.clock.now()),
                ),
            {
              priority: "normal",
              exclusivityKey: summarizeExclusivityKey(input),
              libraryID: input.libraryID,
              inputVersion: SUMMARIZE_INPUT_VERSION,
            },
          );
          const job = await graph.pipelineContext.openJob({
            pipelineId: "summarize",
            token: source.token,
            record,
            collection,
            openOn: "completion",
          });
          const unsubscribe = job.progress.events.subscribe((snapshot) => {
            eta = snapshot.etaSeconds;
          });
          try {
            const output = await pipeline.execute(
              prepared,
              job.context,
              surface,
            );
            outcome = output.outcome;
            stoppedAt = output.stoppedAt;
            summaries = output.summaries;
            view = output.view;
            if (output.outcome === "failed" && isOfflineFailure(output.error)) {
              offline = true;
            }
            job.progress.reporter.done(
              output.outcome === "succeeded"
                ? "succeeded"
                : output.outcome === "failed"
                  ? "failed"
                  : "cancelled",
            );
          } finally {
            unsubscribe();
            await job.checkpoints?.flush().catch(() => undefined);
            job.dispose();
          }
        }
      } catch (error) {
        outcome = source.token.isCancellationRequested
          ? "cancelled"
          : error instanceof ConfigurationError
            ? "unavailable"
            : "failed";
        if (outcome === "failed" && isOfflineFailure(error)) offline = true;
        logger.warn("the summarize run stopped", {
          reason: error instanceof Error ? error.name : typeof error,
        });
      } finally {
        running = undefined;
        source.dispose();
      }
      sink.render(
        buildSummarizeWindowModel(
          { ...view, stage: "done" },
          {
            running: false,
            notice,
            offline,
            outcome: { kind: outcome, stoppedAt },
            exportAvailable: !view.notesWritable && summaries.length > 0,
          },
        ),
      );
    },

    cancel() {
      running?.cancel({ kind: "user" });
    },

    async exportSummaries(path) {
      try {
        const store = await graph.database.summaries();
        if (store === undefined) return "failed";
        const entries: { title: string; noteHtml: string }[] = [];
        for (const ref of summaries) {
          const row = await store.get(ref.storedId);
          if (row === undefined) continue;
          entries.push({
            title: ref.title,
            noteHtml: renderSummaryNoteHtml(row, ref.sourceName),
          });
        }
        await reportFileWriter().writeTextFile(
          path,
          renderSummaryExportHtml(collectionName, entries),
        );
        return "written";
      } catch (error) {
        // The name only: a file error's message can quote the path.
        logger.warn("the summary export failed", {
          reason: error instanceof Error ? error.name : typeof error,
        });
        return "failed";
      }
    },

    closed() {
      running?.cancel({ kind: "user" });
      onClosed();
    },
  };
}

/**
 * Hold the graph for the two collection commands (`P3-T29`), publish the
 * summarize window's opener on `addon.api.summarizeWindow`, and install the
 * queue's visible "jobs resumed" notice (`research-helper-job-resumed`, owner
 * item 250) on the graph's `JobNotifier`; all undone on teardown, which also
 * closes every summarize window still open, as
 * {@link publishReportWindowCommands} does for the report window (owner,
 * `plan/00` §6 item 307(e)).
 */
async function publishSummarizeCommands(
  scope: Scope,
  graph: ServiceGraph,
): Promise<void> {
  // Captured once, for the reason {@link publishServiceGraph} gives.
  const api = addon.api;
  await scope.use({
    description:
      "the summarize window's services, open windows and the resumed-jobs notice",
    register: () => {
      summarizeState.graph = graph;
      api.summarizeWindow = {
        open: (host, collectionID) =>
          openSummarizeWindowCommand(host, collectionID),
        openCount: () =>
          [...summarizeState.windows.keys()].filter(
            (win) => win.closed !== true,
          ).length,
        heldCount: () => summarizeState.windows.size,
      };
      graph.jobNotices.setResumedNotice(async (records) => {
        const text = await formatValue(
          new Localization([MAIN_WINDOW_FTL]),
          L10N_JOB_RESUMED,
          { count: records.length },
        );
        if (text === undefined) {
          throw new Error("[research-helper] the resumed notice has no text");
        }
        const popup = openZoteroProgressWindow();
        popup.changeHeadline(text);
        popup.show();
        popup.startCloseTimer(8000);
      });
      return "summarizeState";
    },
    unregister: () => {
      delete api.summarizeWindow;
      // Item 307(e): a summarize window left open must not outlive the plugin,
      // as `publishReportWindowCommands` does for the report window. Closing
      // it runs the window's `closed()`, which cancels a running job.
      for (const win of [...summarizeState.windows.keys()]) {
        if (win.closed !== true) win.close?.();
      }
      summarizeState.windows.clear();
      graph.jobNotices.setResumedNotice(undefined);
      summarizeState.graph = undefined;
    },
  });
}

// ---------------------------------------------------------------------------
// The report window (`P4-T19`)
// ---------------------------------------------------------------------------

declare module "../addon" {
  interface PluginApi {
    /**
     * The report window's opener over the live graph (`P4-T19`), the command
     * the collection menu's "Generate Research Trends Report…" runs.
     * Published so an integration spec — bundled separately — can open the
     * real window through the plugin's own state and see it closed at
     * shutdown.
     */
    reportWindow?: ReportWindowCommands;
    /**
     * The summarize window's opener over the live graph (`P3-T29`), the
     * command the collection menu's "Summarize All Papers in Collection"
     * runs. Published, as {@link reportWindow} is, so an integration spec can
     * open the real window and see it closed at shutdown (owner, `plan/00` §6
     * item 307(e)).
     */
    summarizeWindow?: SummarizeWindowCommands;
  }
}

/** {@link PluginApi.summarizeWindow}. */
export interface SummarizeWindowCommands {
  /** Open, or raise, the summarize window for one collection. */
  open(
    host: Parameters<NonNullable<SearchMenuCommands["openSummarizeWindow"]>>[0],
    collectionID: number,
  ): SummarizeWindowHandle;
  /** How many summarize windows this instance opened that are still open. */
  openCount(): number;
  /**
   * How many window handles this instance holds. A window leaves when it
   * closes (`P7-T39`), so this equals {@link openCount} unless a handle
   * outlived its window. Published so an integration spec can see it.
   */
  heldCount(): number;
}

/** {@link PluginApi.reportWindow}. */
export interface ReportWindowCommands {
  /** Open, or raise, the report window for one collection. */
  open(host: ReportWindowHost, collectionID: number): ReportWindowHandle;
  /** How many report windows this instance opened that are still open. */
  openCount(): number;
  /**
   * How many window handles this instance holds, as
   * {@link SummarizeWindowCommands.heldCount} counts them (`P7-T39`).
   */
  heldCount(): number;
  /**
   * What the start runs for jobs left paused (`P4-T21`; owner, `plan/00` §6 item
   * 332(b)). Published so an integration spec can run it over a job it paused.
   */
  announcePaused(): Promise<void>;
}

/** One open report window: its handle and its session. */
interface OpenReportWindow {
  readonly win: ReportWindowHandle;
  readonly session: ReportSession;
}

/**
 * The graph the report window reads, and every window this instance opened, by
 * collection id: set by {@link publishReportWindowCommands}, which stops every
 * run, closes the windows and clears the graph in its teardown, so a disable
 * leaves no report window or run behind (`P4-T19` Done when). Module state, as
 * {@link summarizeState} is, because `SEARCH_MENU_COMMANDS` is built before
 * any graph exists.
 *
 * *Changed 2026-11-18 (`P7-T39`, owner, `plan/00` §6 item 403(a)):* a window
 * leaves `windows` when its session's `closed()` runs, not at the next open;
 * the entry kept until then held the closed window alive. Its session, which
 * holds no window once closed, waits in `closedSessions` until the next open
 * forgets it, as the whole entry did before, so a teardown in between still
 * waits for the run that window started to end.
 */
const reportWindowState: {
  graph: ServiceGraph | undefined;
  readonly windows: Map<number, OpenReportWindow>;
  readonly closedSessions: Set<ReportSession>;
} = { graph: undefined, windows: new Map(), closedSessions: new Set() };

/**
 * The menu's "Generate Research Trends Report…": open, or raise, the
 * collection's report window. A window the user closed is forgotten here.
 *
 * *Changed 2026-11-02 (`P4-T20`):* a window still open for the collection is
 * only raised, with no second `openDialog`, because `openDialog` on a named
 * window that exists loads the document again, which would unload the window
 * and cancel its run.
 */
function openReportWindowCommand(
  host: ReportWindowHost,
  collectionID: number,
): ReportWindowHandle {
  const graph = reportWindowState.graph;
  if (graph === undefined) {
    throw new Error("[research-helper] the report window has no services");
  }
  for (const [id, open] of reportWindowState.windows) {
    if (open.win.closed === true) reportWindowState.windows.delete(id);
  }
  reportWindowState.closedSessions.clear();
  const already = reportWindowState.windows.get(collectionID);
  if (already !== undefined) {
    already.win.focus();
    return already.win;
  }
  const session = createReportWindowSession(graph, collectionID, () => {
    // Forgotten when it closes (`P7-T39`); the session waits for teardown.
    if (reportWindowState.windows.get(collectionID)?.session === session) {
      reportWindowState.windows.delete(collectionID);
      reportWindowState.closedSessions.add(session);
    }
  });
  const win = openReportWindow(host, collectionID, session);
  reportWindowState.windows.set(collectionID, { win, session });
  return win;
}

/**
 * `P6-T17`'s "Generate Audio Report…": the collection's report window, opened
 * or raised as {@link openReportWindowCommand} does; its audio section works on
 * the newest stored report. Opens nothing while the hidden `audio.enabled` is
 * off, read on every call; opening it starts no job.
 */
function openAudioReportWindowCommand(
  host: ReportWindowHost,
  collectionID: number,
): ReportWindowHandle | undefined {
  if (!getPref("audioEnabled")) return undefined;
  return openReportWindowCommand(host, collectionID);
}

/** `P4-T16`'s dialog over the graph, for the report run's confirmation. */
function reportConfirmDeps(graph: ServiceGraph): ReportConfirmDeps {
  return {
    openDialog: confirmRunCost,
    settle: (disclosure, outcome) => {
      settleDisclosure(disclosure, outcome);
    },
    confirmAboveCents: () => getPref("summaryConfirmAboveCents"),
    fullTextAutoMaxPapers: () => getPref("summaryFullTextAutoMaxPapers"),
    providerName: (disclosure) =>
      providerDisplayName(graph, disclosure.providerId),
    locale: appLocale,
  };
}

/** A window's session, with what only the host calls. */
interface ReportSession extends ReportWindowSession {
  /**
   * Plugin teardown: cancel a run this window started as a shutdown (the
   * pipeline leaves its record for `recover()`) and wait for it to end.
   */
  shutdown(): Promise<void>;
}

/**
 * The report window's host (`P4-T19`, `P4-T20`): the privileged side of one
 * window, the file `plan/07` `P4-T20` names, as `publishSearchWindowHost` is
 * for the search window. `ui/` may not import `zotero/` or `llm/`, so every
 * Zotero and job action reaches the window through here.
 *
 * - **`start`** runs the pipeline's two halves (`docs/07` §12.4's note of
 *   2026-11-01, reading 1): `prepare` in a job context with no record; then,
 *   only when it says "run", the record is enqueued with the confirmed
 *   disclosure's egress log and `execute` runs in its context, and the
 *   checkpoints are flushed. The window's Cancel, or the window closing,
 *   cancels the run's token.
 * - **`attach`** (owner, `plan/00` §6 item 324(a)): a job resumed after a
 *   restart is found on {@link ServiceGraph.resumedReports} and the window
 *   attaches to its surface, so its pending question is asked now; closing the
 *   window leaves it waiting. A job left `paused` with no run in memory (a
 *   spend guard at restart, or a shutdown while it waited) asks here too:
 *   "continue" prepares it again, with the run's confirmation, and executes it
 *   in its own record, the cache serving what was paid for; "stop" cancels the
 *   record, and the paid-for cache entries stay (item 324(b)).
 * - **Delivery:** the note outcomes (`settleReportNote`), the Markdown export
 *   (`exportReportMarkdown` over `reportFileWriter`; the path is used once and
 *   never kept or logged, `docs/09` §2.2) and the text for Copy, which the
 *   window script puts on the clipboard (`src/` outside `zotero/` may not name
 *   `Zotero`).
 *
 * The model line is the `strong` chain's answer (`reportModel`, then
 * `<provider>.model`; `docs/07` §8.5) — the owner's "resolved report model as
 * text" (`plan/00` §6 item 286). A chain with every setting empty is a
 * `ConfigurationError` from the router, drawn as "no report model is set"; any
 * other failure rejects `describe()`, which the window logs by name.
 *
 * @param onClosed - run at the end of `closed()`, so the opener forgets the
 *   window (`P7-T39`)
 */
function createReportWindowSession(
  graph: ServiceGraph,
  collectionID: number,
  onClosed: () => void,
): ReportSession {
  const logger = graph.logger.child({ surface: "reportWindow" });
  let state: ReportRunState = IDLE_REPORT_RUN;
  let sink: ReportWindowSink | undefined;
  let closed = false;
  let header = describeCollectionForSummary(collectionID);
  let modelSet = false;
  let source: CancellationTokenSource | undefined;
  let ended: Promise<void> | undefined;
  let currentJob: PipelineJob | undefined;
  // The run's saved reports (two on a `both` run) and the one the preview and
  // the delivery buttons act on (`docs/08` §6.3's note of 2026-11-02).
  let delivered: TrendReportDelivery[] = [];
  let shown = 0;
  let resumed: ResumedReportRun | undefined;
  let detach: (() => void) | undefined;
  // `P6-T17`: the audio section (`docs/08` §6.4's note of 2026-11-17): its
  // state, the record it works on, its run and what that run left to save.
  let audioState: AudioSectionState = IDLE_AUDIO_SECTION;
  let audioReport: TrendReport | undefined;
  let audioSource: CancellationTokenSource | undefined;
  let audioEnded: Promise<void> | undefined;
  let audioOutput: AudioReportOutput | undefined;

  // Main-bundle lines, formatted once each: the window links its own bundle
  // only (docs/08 §10.1), so a stop's reason reaches it as text.
  const texts = new Map<string, string>();
  const formatLine = async (line: MainWindowLine): Promise<string> => {
    const key = JSON.stringify([line.id, line.args]);
    const known = texts.get(key);
    if (known !== undefined) return known;
    const text =
      (await (
        formatValue as (
          l10n: Localization,
          id: string,
          args?: unknown,
        ) => Promise<string | undefined>
      )(new Localization([MAIN_WINDOW_FTL]), line.id, line.args)) ?? line.id;
    texts.set(key, text);
    return text;
  };

  const draw = (): void => {
    if (sink === undefined) return;
    const model = buildReportRunModel(state, {
      // The report and the audio never run at once (§6.4's note, point 5).
      canStart: header !== undefined && modelSet && audioSource === undefined,
      saveNoteSetting: getPref("reportSaveNote"),
      libraryEditable: header?.editable === true,
      locale: appLocale(),
    });
    const formatted = (line: MainWindowLine): string | undefined => {
      const known = texts.get(JSON.stringify([line.id, line.args]));
      if (known === undefined) {
        void formatLine(line).then(draw, () => undefined);
      }
      return known;
    };
    const audio = audioState.enabled
      ? windowAudioModel(
          buildAudioSectionModel(audioState, {
            reportRunning: state.running || source !== undefined,
          }),
          formatted,
        )
      : undefined;
    try {
      sink.render({
        ...windowRunModel(model, formatted),
        ...(audio !== undefined && { audio }),
      });
    } catch {
      // A window that throws loses the view, not the run.
    }
  };

  const dispatch = (event: ReportRunEvent): void => {
    state = reduceReportRun(state, event);
    draw();
  };

  const dispatchAudio = (event: AudioSectionEvent): void => {
    audioState = reduceAudioSection(audioState, event);
    draw();
  };

  /**
   * What is waiting on a person: a cancel, the window closing or a shutdown
   * answers it, so no run (and no teardown) waits on a dialog left open.
   */
  const waits = new Set<() => void>();
  const releaseWaits = (): void => {
    for (const release of [...waits]) release();
  };
  const orReleased = <T>(work: Promise<T>, fallback: T): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const release = (): void => {
        waits.delete(release);
        resolve(fallback);
      };
      waits.add(release);
      work.then(
        (value) => {
          waits.delete(release);
          resolve(value);
        },
        (error: unknown) => {
          waits.delete(release);
          reject(error instanceof Error ? error : new Error(String(error)));
        },
      );
    });

  /** Ask in the window; with no window there is nobody to say yes. */
  const askWindow = async (
    question: ReportQuestion,
  ): Promise<"resume" | "cancel"> => {
    const open = sink;
    if (open === undefined) return "cancel";
    const line = isMainWindowLine(question.line)
      ? { text: await formatLine(question.line) }
      : question.line;
    return orReleased(open.ask({ ...question, line }), "cancel");
  };

  /** A paused run's question: money in the cost dialog, the rest in place. */
  const askPaused: TrendReportSurface["ask"] = async (question) => {
    if (question.reason === "budget-stop") {
      const outcome = await orReleased(
        confirmRunCost({
          mode: "ceiling",
          stop: question.stop,
          remainingUsd: question.remainingUsd,
          raiseToUsd: question.raiseToUsd,
          usage: question.usage,
        }),
        { kind: "stop" } as const,
      );
      return outcome.kind === "continue" ? "resume" : "cancel";
    }
    return askWindow(
      reportPauseQuestion(
        question,
        question.reason === "credential-required"
          ? await providerDisplayName(graph, question.providerId)
          : "",
      ),
    );
  };

  /** The run's events, for a run this window started or attached to. */
  const listener: Omit<TrendReportListener, "finished"> = {
    update: (view) => {
      if (currentJob !== undefined) {
        state = reduceReportRun(state, {
          kind: "spend",
          usd: currentJob.budget.spentUsd,
        });
      }
      dispatch({ kind: "view", view });
    },
    ask: askPaused,
    onDraft: (delta) => {
      dispatch({ kind: "draft", delta });
    },
    onRevision: (signal) => {
      dispatch({ kind: "revision", signal });
    },
  };

  const labelsOf = (stored: TrendReport): Required<ReportExportLabels> => ({
    retractedHeading: reportLabel(stored.language, "retractedHeading"),
    // `P7-T35` (owner, `plan/00` §6 item 395(c)).
    semanticScholarAttribution: reportLabel(
      stored.language,
      "semanticScholarAttribution",
    ),
  });

  /** The text the preview ends on and Copy takes: what the export writes. */
  const finalText = (stored: TrendReport): string => {
    try {
      return renderReportMarkdown(stored, labelsOf(stored));
    } catch {
      return stored.markdown;
    }
  };

  const noteDeps = (
    index: number,
    ask: ReportNoteDeps["ask"],
  ): ReportNoteDeps => ({
    ask,
    write: (answer) => {
      const one = delivered[index];
      if (one === undefined) {
        return Promise.reject(new Error("no report to write"));
      }
      return writeReportNote({
        report: one.report,
        html: one.noteHtml,
        groupConfirmation: answer,
      });
    },
    store: async (noteKey) => {
      const reports = await graph.database.reports();
      const one = delivered[index];
      if (one !== undefined && reports !== undefined) {
        delivered[index] = {
          ...one,
          report: await reports.put({ ...one.report, zoteroNoteKey: noteKey }),
        };
      }
    },
  });

  /** The language to name on a `note` event: a two-report run's only. */
  const noteLanguage = (index: number): TrendReport["language"] | undefined =>
    delivered.length > 1 ? delivered[index]?.report.language : undefined;

  /** Draw the run's end and follow its note. */
  const finishRun = async (output: TrendReportOutput): Promise<void> => {
    delivered = [...(output.reports ?? [])];
    const first = interfaceReportLanguage(appLocale());
    shown = Math.max(
      delivered.findIndex((one) => one.report.language === first),
      0,
    );
    const noteOf = (one: TrendReportDelivery): "off" | undefined =>
      one.note === undefined ? "off" : undefined;
    const showing = delivered[shown];
    dispatch({
      kind: "finished",
      outcome: output.outcome,
      // `P7-T33`: a run that failed offline says so (`plan/00` §6 item 393).
      stop: stopForFailure(output.outcome, output.stop, output.error?.code),
      markdown: showing === undefined ? undefined : finalText(showing.report),
      note: showing === undefined ? undefined : noteOf(showing),
      ...(delivered.length > 1 && {
        reports: delivered.map((one) => ({
          language: one.report.language,
          text: finalText(one.report),
          note: noteOf(one),
        })),
        shown: showing?.report.language,
      }),
    });
    // The audio section works on the report the run saved (§6.4's note).
    if (showing !== undefined) void loadAudioReport(showing.report);
    // One group question for the run: its answer holds for both notes
    // (`docs/07` §12.4 reading 22).
    const ask = askOnce(askWindow);
    for (const [index, one] of delivered.entries()) {
      if (one.note === undefined) continue;
      dispatch({
        kind: "note",
        language: noteLanguage(index),
        note: await settleReportNote(one.note, noteDeps(index, ask)),
      });
    }
  };

  /** The run: `existing` is a paused job's own record, otherwise a new one. */
  const runJob = async (
    input: TrendReportInput,
    existing: JobRecord | undefined,
  ): Promise<void> => {
    const pipeline = graph.pipelines.get("trendReport") as
      TrendReportPipeline | undefined;
    const running = createCancellationTokenSource();
    source = running;
    dispatch({ kind: "started" });
    const surface: TrendReportSurface = {
      ...listener,
      confirm: async (request) => {
        const result = await orReleased(
          confirmReportRun(reportConfirmDeps(graph), request),
          { answer: { kind: "cancelled" }, notice: undefined } as const,
        );
        dispatch({ kind: "notice", line: result.notice });
        return result.answer;
      },
    };
    try {
      if (pipeline === undefined) {
        throw new ConfigurationError("the report pipeline is not available");
      }
      const collection = {
        libraryID: input.libraryID,
        collectionKey: input.collectionKey,
      };
      const before = await graph.pipelineContext.openJob({
        pipelineId: "trendReport",
        token: running.token,
        collection,
        openOn: "completion",
      });
      let prepared;
      try {
        prepared = await pipeline.prepare(input, before.context, surface);
      } finally {
        before.dispose();
      }
      if (prepared.status === "declined") {
        dispatch({ kind: "finished", outcome: "declined" });
        return;
      }
      const record =
        existing ??
        (await graph.jobs.enqueue(
          "trendReport",
          prepared.disclosure === undefined
            ? input
            : withEgressLog(
                input,
                egressLogEntry(prepared.disclosure, graph.clock.now()),
              ),
          {
            priority: "normal",
            exclusivityKey: trendReportExclusivityKey(input),
            libraryID: input.libraryID,
            inputVersion: TREND_REPORT_INPUT_VERSION,
          },
        ));
      const job = await graph.pipelineContext.openJob({
        pipelineId: "trendReport",
        token: running.token,
        record,
        collection,
        openOn: "completion",
      });
      currentJob = job;
      try {
        const output = await pipeline.execute(prepared, job.context, surface);
        job.progress.reporter.done(
          output.outcome === "succeeded"
            ? "succeeded"
            : output.outcome === "failed"
              ? "failed"
              : "cancelled",
        );
        await finishRun(output);
      } finally {
        currentJob = undefined;
        await job.checkpoints?.flush().catch(() => undefined);
        job.dispose();
      }
    } catch (error) {
      logger.warn("the report run stopped", {
        reason: error instanceof Error ? error.name : typeof error,
      });
      const outcome =
        running.token.reason?.kind === "shutdown"
          ? "interrupted"
          : running.token.isCancellationRequested
            ? "cancelled"
            : error instanceof ConfigurationError
              ? "unavailable"
              : "failed";
      dispatch({
        kind: "finished",
        outcome,
        // `P7-T33`: an error thrown offline says so (`plan/00` §6 item 393).
        stop: stopForFailure(
          outcome,
          undefined,
          error instanceof ResearchHelperError ? error.code : undefined,
        ),
      });
    } finally {
      if (source === running) source = undefined;
      running.dispose();
    }
  };

  /**
   * Owner, plan/00 §6 item 324(a): a paused job of this collection asks; so does
   * one `recover()` left `interrupted` (item 334(j)).
   */
  const askPausedJob = async (): Promise<void> => {
    if (header === undefined) return;
    const { libraryID, collectionKey } = header;
    let records: readonly JobRecord[];
    try {
      records = await waitingReportJobs(graph.jobs);
    } catch {
      return; // No job store: nothing was left paused.
    }
    const paused = records
      .filter((record) => {
        const input = record.input as Partial<TrendReportInput>;
        return (
          input.libraryID === libraryID && input.collectionKey === collectionKey
        );
      })
      .sort((a, b) => b.createdAtEpochMs - a.createdAtEpochMs)[0];
    if (paused === undefined || closed) return;
    dispatch({ kind: "paused-job", reason: paused.pauseReason ?? "other" });
    const answer = await askWindow(pausedJobQuestion(paused.pauseReason));
    if (closed) return; // The window went away: the job keeps waiting.
    if (answer === "resume") {
      const record = await pausedForAnswer(graph.jobs, paused);
      ended = runJob(record.input as TrendReportInput, record);
      await ended;
      // Declined at the confirmation: the record is still paused.
      if (state.outcome === "declined") await askPausedJob();
      return;
    }
    await graph.jobs.cancel(paused.id);
    dispatch({ kind: "paused-job", reason: undefined });
  };

  // -------------------------------------------------------------------------
  // `P6-T17`: the audio section (`docs/08` §6.4's note of 2026-11-17)
  // -------------------------------------------------------------------------

  const audioPipeline = (): AudioReportPipeline | undefined =>
    graph.pipelines.get("audioReport") as AudioReportPipeline | undefined;

  /** `tts.language`, narrowed: a hand-edited value reads as `auto`. */
  const ttsLanguagePref = (): AudioLanguage | "auto" => {
    const value = getPref("ttsLanguage");
    return value === "en" || value === "ko" ? value : "auto";
  };

  /**
   * The record the section works on: `fromRun` (the report the window's run
   * saved, the one shown), else the collection's newest stored report.
   */
  const loadAudioReport = async (
    fromRun: TrendReport | undefined,
  ): Promise<void> => {
    if (!audioState.enabled || audioSource !== undefined) return;
    let report = fromRun;
    let companion: TrendReport | undefined;
    try {
      const reports = await graph.database.reports();
      if (reports !== undefined) {
        if (report === undefined && header !== undefined) {
          report = await reports.latestForCollection(
            header.libraryID,
            header.collectionKey,
          );
        }
        if (report !== undefined) companion = await reports.companionOf(report);
      }
    } catch (error) {
      logger.warn("the audio section could not read the stored reports", {
        reason: error instanceof Error ? error.name : typeof error,
      });
    }
    audioReport = report;
    dispatchAudio({
      kind: "audio-report",
      report:
        report === undefined
          ? undefined
          : {
              id: report.id,
              language: report.language,
              companionLanguage: companion?.language,
            },
      language:
        report === undefined
          ? "en"
          : resolveAudioLanguage(ttsLanguagePref(), report),
    });
  };

  /** `listVoices` for `language`; the selection kept when still listed. */
  const loadVoices = async (language: AudioLanguage): Promise<void> => {
    const pipeline = audioPipeline();
    if (pipeline === undefined) return;
    const listing = createCancellationTokenSource();
    try {
      const voices = (await pipeline.voices(language, listing.token)).map(
        (voice) => ({ id: voice.id, label: voice.displayName }),
      );
      dispatchAudio({
        kind: "audio-voices",
        voices,
        voice: initialAudioVoice(
          voices,
          audioState.voice ?? getPref("ttsVoice"),
        ),
      });
    } catch (error) {
      logger.warn("the voice list could not be read", {
        reason: error instanceof Error ? error.name : typeof error,
      });
    } finally {
      listing.dispose();
    }
  };

  /** Each language's attachment title, with a slot for the delivery date. */
  const DATE_SLOT = "{{date}}";
  const audioTitles = async (): Promise<Map<AudioLanguage, string>> => {
    const titles = new Map<AudioLanguage, string>();
    const l10n = new Localization([MAIN_WINDOW_FTL]);
    for (const language of ["en", "ko"] as const) {
      const text = await formatValue(l10n, L10N_AUDIO_ATTACHMENT_TITLE, {
        language,
        date: DATE_SLOT,
      });
      if (text !== undefined) titles.set(language, text);
    }
    return titles;
  };

  /** One of the run's two confirmations, in `P6-T15`'s cost dialog. */
  const confirmAudio = async (
    request: AudioConfirmRequest,
  ): Promise<AudioConfirmAnswer> => {
    const common = {
      disclosure: request.disclosure,
      providerName: await providerDisplayName(graph, "gemini"),
      confirmAboveCents: getPref("summaryConfirmAboveCents"),
      ceiling: request.ceiling,
      session: request.session,
      askTierQuestion: request.askTierQuestion,
      pricesAsOfEpochMs: request.pricesAsOfEpochMs,
    };
    const input: AudioDialogInput =
      request.step === "script"
        ? {
            ...common,
            step: "script",
            estimate: request.estimate,
            targetMinutes: request.targetMinutes,
          }
        : {
            ...common,
            step: "audio",
            plan: request.plan,
            warnings: request.warnings,
          };
    const outcome = await confirmAudioCost(input);
    settleDisclosure(
      request.disclosure,
      outcome.kind === "run" ? "confirmed" : "cancelled",
    );
    if (outcome.kind !== "run") return { kind: "cancelled" };
    return {
      kind: "run",
      ...(outcome.raise !== undefined && { raise: outcome.raise }),
      ...(outcome.tierAnswer !== undefined && {
        tierAnswer: outcome.tierAnswer,
      }),
    };
  };

  /** The run's end, as the section shows it and what it leaves to save. */
  const finishAudio = (output: AudioReportOutput): void => {
    audioOutput = output;
    if (output.report !== undefined) audioReport = output.report;
    const failure = output.failure;
    dispatchAudio({
      kind: "audio-finished",
      outcome: output.outcome,
      refusal: output.refusal,
      failure:
        failure === undefined
          ? undefined
          : {
              messageKey: failure.messageKey,
              messageArgs: failure.messageArgs,
            },
      offers: {
        script:
          failure?.offerScriptText === true && output.script !== undefined,
        audio: failure?.offerAudioSaveAs === true && output.audio !== undefined,
      },
    });
  };

  /**
   * The `audioReport` job, as {@link runJob} runs the report's: `prepare` in a
   * context with no record; only a confirmed run is enqueued, with its egress
   * log (`audioJobInput`), and `execute` runs in the record's context.
   */
  const runAudio = async (
    pipeline: AudioReportPipeline,
    report: TrendReport,
    input: AudioRunInput,
  ): Promise<void> => {
    const running = createCancellationTokenSource();
    audioSource = running;
    audioOutput = undefined;
    dispatchAudio({ kind: "audio-started" });
    let titles = new Map<AudioLanguage, string>();
    const surface: AudioReportSurface = {
      update: (view) => {
        dispatchAudio({ kind: "audio-view", view });
      },
      confirm: (request) =>
        orReleased(confirmAudio(request), { kind: "cancelled" } as const),
      ask: askPaused,
      pickFolder: async () => {
        const open = sink;
        if (open?.pickFolder === undefined) return undefined;
        // The path is handed to the pipeline once; never kept or logged here.
        const path = await orReleased(open.pickFolder(), "");
        return path === "" ? undefined : path;
      },
      title: (language, isoDate) => {
        const template = titles.get(language);
        return template === undefined
          ? defaultAudioTitle(language, isoDate)
          : template.replace(/⁨?\{\{date\}\}⁩?/u, isoDate);
      },
    };
    const collection = {
      libraryID: report.libraryID,
      collectionKey: report.collectionKey,
    };
    try {
      titles = await audioTitles().catch(() => titles);
      const before = await graph.pipelineContext.openJob({
        pipelineId: "audioReport",
        token: running.token,
        collection,
        openOn: "completion",
      });
      let prepared;
      try {
        prepared = await pipeline.prepare(input, before.context, surface);
        if (prepared.status !== "run") {
          finishAudio(
            await pipeline.execute(prepared, before.context, surface),
          );
          return;
        }
      } finally {
        before.dispose();
      }
      const record = await graph.jobs.enqueue(
        "audioReport",
        audioJobInput(prepared, graph.clock.now()),
        {
          priority: "normal",
          exclusivityKey: audioReportExclusivityKey(input),
          libraryID: report.libraryID,
          inputVersion: AUDIO_REPORT_INPUT_VERSION,
        },
      );
      const job = await graph.pipelineContext.openJob({
        pipelineId: "audioReport",
        token: running.token,
        record,
        collection,
        openOn: "completion",
      });
      try {
        const output = await pipeline.execute(prepared, job.context, surface);
        job.progress.reporter.done(
          output.outcome === "succeeded"
            ? "succeeded"
            : output.outcome === "failed"
              ? "failed"
              : "cancelled",
        );
        finishAudio(output);
      } finally {
        job.dispose();
      }
    } catch (error) {
      logger.warn("the audio run stopped", {
        reason: error instanceof Error ? error.name : typeof error,
      });
      dispatchAudio({
        kind: "audio-finished",
        outcome:
          running.token.reason?.kind === "shutdown"
            ? "interrupted"
            : running.token.isCancellationRequested
              ? "cancelled"
              : "failed",
        offers: { script: false, audio: false },
      });
    } finally {
      if (audioSource === running) audioSource = undefined;
      running.dispose();
      draw();
    }
  };

  return {
    async describe() {
      header = describeCollectionForSummary(collectionID);
      let model: { modelId: string; providerName: string } | undefined;
      try {
        const resolved = graph.llm.router.resolveModel("strong");
        model = {
          modelId: resolved.modelId,
          providerName: await providerDisplayName(graph, resolved.providerId),
        };
      } catch (error) {
        if (!(error instanceof ConfigurationError)) throw error;
        model = undefined;
      }
      modelSet = model !== undefined;
      return buildReportWindowModel({
        collection:
          header === undefined
            ? undefined
            : { name: header.name, regularItems: header.regularItems },
        language: getPref("reportLanguage"),
        model,
      });
    },

    async attach(windowSink) {
      sink = windowSink;
      draw();
      if (header === undefined) return;
      await graph.database.ready;
      if (closed || source !== undefined) return;
      const run = graph.resumedReports.find(
        header.libraryID,
        header.collectionKey,
      );
      if (run === undefined) {
        await askPausedJob();
        return;
      }
      resumed = run;
      dispatch({ kind: "started" });
      detach = run.surface.attach({
        ...listener,
        finished: (output) => {
          resumed = undefined;
          void finishRun(output);
        },
      });
    },

    async start(options, windowSink) {
      if (source !== undefined || resumed !== undefined) return;
      sink = windowSink;
      header = describeCollectionForSummary(collectionID);
      if (header === undefined) {
        dispatch({ kind: "finished", outcome: "unavailable" });
        return;
      }
      ended = runJob(
        {
          libraryID: header.libraryID,
          collectionKey: header.collectionKey,
          language: resolveReportLanguage(options.language, appLocale()),
        },
        undefined,
      );
      await ended;
    },

    cancel() {
      if (resumed !== undefined) resumed.cancel();
      else source?.cancel({ kind: "user" });
      releaseWaits();
    },

    showReport(language) {
      const index = delivered.findIndex(
        (one) => one.report.language === language,
      );
      if (index < 0 || index === shown) return;
      shown = index;
      dispatch({ kind: "show-report", language });
      void loadAudioReport(delivered[index]?.report);
    },

    async saveNote() {
      const index = shown;
      if (delivered[index] === undefined) return;
      dispatch({
        kind: "note",
        language: noteLanguage(index),
        note: await settleReportNote(undefined, noteDeps(index, askWindow)),
      });
    },

    exportFileName() {
      const report = delivered[shown]?.report;
      return report === undefined
        ? undefined
        : reportExportFileName(
            report.collectionName,
            report.generatedAtEpochMs,
            delivered.length > 1 ? report.language : undefined,
          );
    },

    async exportMarkdown(path) {
      const report = delivered[shown]?.report;
      if (report === undefined || path === "") return;
      const outcome = await exportReportMarkdown(path, report, {
        files: reportFileWriter(),
        logger,
        labels: labelsOf(report),
      });
      if (outcome !== "no-path") dispatch({ kind: "exported", outcome });
    },

    copyText() {
      const report = delivered[shown]?.report;
      return report === undefined ? undefined : finalText(report);
    },

    copied() {
      dispatch({ kind: "copied" });
    },

    closed() {
      closed = true;
      sink = undefined;
      // A resumed run or a paused job waits for the next window (item 324(a)).
      detach?.();
      detach = undefined;
      source?.cancel({ kind: "user" });
      audioSource?.cancel({ kind: "user" });
      releaseWaits();
      onClosed();
    },

    async shutdown() {
      source?.cancel({ kind: "shutdown" });
      audioSource?.cancel({ kind: "shutdown" });
      releaseWaits();
      await ended?.catch(() => undefined);
      await audioEnded?.catch(() => undefined);
    },

    async audioDescribe() {
      const enabled = getPref("audioEnabled");
      dispatchAudio({ kind: "audio-enabled", enabled });
      if (!enabled || audioPipeline() === undefined) return;
      await graph.database.ready;
      await loadAudioReport(delivered[shown]?.report);
      await loadVoices(audioState.language ?? "en");
    },

    setAudioLanguage(language) {
      if (language !== "en" && language !== "ko") return;
      dispatchAudio({ kind: "audio-language", language });
      void loadVoices(language);
    },

    setAudioVoice(voice) {
      if (
        audioSource !== undefined ||
        !audioState.voices.some((one) => one.id === voice)
      ) {
        return;
      }
      // `plan/09` §0.4 line 11: the choice is written back at once.
      setPref("ttsVoice", voice);
      dispatchAudio({ kind: "audio-voice", voice });
    },

    async startAudio(options, windowSink) {
      if (
        audioSource !== undefined ||
        source !== undefined ||
        resumed !== undefined
      ) {
        return;
      }
      sink = windowSink;
      const pipeline = audioPipeline();
      const report = audioReport;
      if (
        pipeline === undefined ||
        report === undefined ||
        !getPref("audioEnabled")
      ) {
        return;
      }
      audioEnded = runAudio(pipeline, report, {
        reportId: report.id,
        language: options.language === "ko" ? "ko" : "en",
        voice: options.voice,
      });
      await audioEnded;
    },

    cancelAudio() {
      audioSource?.cancel({ kind: "user" });
      releaseWaits();
    },

    scriptFileName() {
      const script = audioOutput?.script;
      return script === undefined ||
        audioReport === undefined ||
        !audioState.offers.script
        ? undefined
        : scriptTextFileName(audioReport, script.language);
    },

    async saveScript(path) {
      const script = audioOutput?.script;
      const report = audioReport;
      if (script === undefined || report === undefined || path === "") return;
      if (!audioState.offers.script) return;
      dispatchAudio({
        kind: "audio-saved",
        saveKind: "script",
        outcome: await saveScriptAsText(path, report, script, {
          files: reportFileWriter(),
          logger,
        }),
      });
    },

    audioFileName() {
      const output = audioOutput;
      const report = audioReport;
      if (output?.audio === undefined || report === undefined) return undefined;
      if (!audioState.offers.audio) return undefined;
      return wavFileName(
        audioFileStem(
          report.collectionName,
          localDate(graph.clock.now()).compact,
          output.language ?? report.language,
        ),
      );
    },

    async saveAudio(path) {
      const audio = audioOutput?.audio;
      const report = audioReport;
      if (audio === undefined || report === undefined || path === "") return;
      if (!audioState.offers.audio) return;
      dispatchAudio({
        kind: "audio-saved",
        saveKind: "audio",
        outcome: await saveAudioAs(path, audio, {
          files: zoteroAudioFileSystem(),
          logger,
          reportId: report.id,
        }),
      });
    },
  };
}

/**
 * The paused-job notice in Zotero's progress window (`P4-T21`; owner, `plan/00`
 * §6 item 332(b)), as the resumed-jobs notice is shown. A job whose collection
 * has gone is left out; with none left nothing is shown. The caller's
 * {@link announcePausedReports} tries again next start if this throws.
 */
async function showPausedReportNotice(
  records: readonly JobRecord[],
): Promise<void> {
  const args = pausedReportNoticeArgs(records, collectionNameOfKey);
  if (args === undefined) return;
  const text = await formatValue(
    new Localization([MAIN_WINDOW_FTL]),
    L10N_REPORT_PAUSED_NOTICE,
    args,
  );
  if (text === undefined) {
    throw new Error("[research-helper] the paused-report notice has no text");
  }
  const popup = openZoteroProgressWindow();
  popup.changeHeadline(text);
  popup.show();
  popup.startCloseTimer(8000);
}

/**
 * Hold the graph for the report window (`P4-T19`) and publish its opener on
 * `addon.api.reportWindow`; on teardown, stop every run a window started (as a
 * shutdown, waiting for each to end while the database is still open), close
 * every report window still open and withdraw both.
 */
async function publishReportWindowCommands(
  scope: Scope,
  graph: ServiceGraph,
): Promise<void> {
  // Captured once, for the reason {@link publishServiceGraph} gives.
  const api = addon.api;
  let pausedNotice: Promise<void> | undefined;
  const announcePaused = async (): Promise<void> => {
    await announcePausedReports({
      jobs: graph.jobs,
      readShown: () => getPref("reportPausedNoticeShown"),
      writeShown: (json) => {
        setPref("reportPausedNoticeShown", json);
      },
      show: showPausedReportNotice,
    });
  };
  await scope.use({
    description: "the report window's services, runs and open windows",
    register: () => {
      reportWindowState.graph = graph;
      // Owner, `plan/00` §6 item 332(b): not awaited, so no notice holds up the
      // start; teardown waits for it (`docs/07` §12.4 reading 23).
      pausedNotice = graph.database
        .recovery()
        .then(announcePaused)
        .catch((error: unknown) => {
          // With no job store nothing was left paused; the name only.
          graph.logger.debug("no paused-report notice was shown", {
            reason: error instanceof Error ? error.name : typeof error,
          });
        });
      api.reportWindow = {
        open: (host, collectionID) =>
          openReportWindowCommand(host, collectionID),
        openCount: () =>
          [...reportWindowState.windows.values()].filter(
            (open) => open.win.closed !== true,
          ).length,
        heldCount: () => reportWindowState.windows.size,
        announcePaused,
      };
      return "reportWindowState";
    },
    unregister: async () => {
      delete api.reportWindow;
      await pausedNotice;
      const open = [...reportWindowState.windows.values()];
      const sessions = [
        ...open.map((one) => one.session),
        ...reportWindowState.closedSessions,
      ];
      await Promise.allSettled(sessions.map((session) => session.shutdown()));
      for (const one of open) {
        if (one.win.closed !== true) one.win.close?.();
      }
      reportWindowState.windows.clear();
      reportWindowState.closedSessions.clear();
      reportWindowState.graph = undefined;
    },
  });
}

/**
 * Run the composition root, then the application-scoped registrations, into
 * the root scope.
 *
 * Sequential rather than `Promise.all`: teardown is last-in-first-out, so a
 * deterministic registration order gives a deterministic teardown order, and
 * a registration that fails does not leave later ones half-applied behind it.
 *
 * ## The {@link import("./container").ServiceGraph} is now held — and was not
 *
 * **Until `P1-T35` this paragraph said the graph was deliberately not held
 * anywhere**, and gave three reasons: three of its four services are already
 * reachable through the process-wide accessors their own modules export
 * (`httpRequest()`, `getHostLimiters()`, `getPref()`), "nothing in Phase 1 yet
 * has a pipeline to hand the fourth to, and the typed service locator is
 * `P1-T16` step 7's — it `create`s this path for that. Standing up a holder
 * with no consumer is the dead code `P0-T07` declined to write for the same
 * reason."
 *
 * **The first reason still stands; the second has expired.** `P1-T16` landed
 * and built the pipeline — `ServiceGraph.pipelineContext` is declared at
 * `container.ts:830` and constructed at `:1419` — and `P1-T22` built the
 * window's host around it. So there is now a consumer, and the graph is held on
 * the plugin instance at `addon.api.services` by {@link publishServiceGraph}.
 * That is this paragraph's own condition being met, not a reversal of
 * `P0-T07`'s judgement: the holder exists because something reads it, which is
 * exactly the test the old text set.
 *
 * It is held on `addon.api` rather than in a module-level variable because a
 * module-level one is unreachable from outside the plugin bundle — an
 * integration spec is bundled separately and gets its own copy of every module,
 * with none of that module's state — and because `src/addon.ts`'s own comment
 * has been promising this since `P0-T07`: "the service-locator half arrives
 * with Phase 1".
 */
export async function registerUI(scope: Scope): Promise<void> {
  // `P7-T13`: the last lines this plugin lifetime logged, for the diagnostics
  // text (`docs/07` §10.4 item 4). Memory only; a fresh ring per start.
  const logRing = createLogRing();
  const graph = await installServices(scope, {
    transport: createZoteroHttpTransport(),
    prefs: createZoteroPrefStore(),
    version,
    // A Fluent lookup since `P1-T32`, awaited once by `installServices`:
    // `ZoteroProgressWindowSink` needs an already-localized string and the
    // factory that builds it is synchronous, so the resolution has to happen
    // here. See {@link PROGRESS_HEADLINE} for why `new Localization([...])` is
    // the only route from an application-scoped startup, and for what happens
    // when it resolves nothing.
    progressHeadline: PROGRESS_HEADLINE,
    // Both channels of `docs/07` §10.3, and one prefix. The lossy sink
    // `P1-T25` had to build here — no level, no `reportError` — is gone; the
    // real one is `container.ts`'s, over `zoteroApi.ts`'s two facades.
    // `P7-T13`: wrapped so the ring keeps each finished, redacted line.
    logSink: withLogRing(createZoteroLogSink(), logRing),
    // The plugin database (`P3-T33`; `plan/00` §6 item 249): opened once by
    // `installServices` and shared by every store, closed in its teardown.
    pluginDatabase: {
      open: openPluginDatabase,
      path: pluginDatabasePath,
      blobs: createCacheBlobStore(),
    },
    // The shipped prompt versions for `docs/07` §9.3's startup comparison
    // (`P3-T26`). A lazy `import()`: `../prompts/bundled` imports the `.md`
    // prompt files, which no unit test that imports this module may reach.
    promptVersions: async () =>
      (await import("../prompts/bundled")).PROMPT_VERSIONS,
    // `docs/09` §1.7's degradation dialog (`P3-T03`), asked only when the
    // keystore probe fails. See {@link chooseSecretBackend}.
    chooseSecretBackend,
    // The one session spend counter (`P3-T16`): every job's budget guard
    // shares it (`P3-T35`), and the Usage readout below reads the same one.
    sessionSpend,
  });

  await publishServiceGraph(scope, graph);
  // Before the host and the menus that read it (`P2-T17`), so teardown — last
  // in, first out — removes both before the store is withdrawn, and all three
  // before the graph's own teardown closes the connection. The open itself
  // runs in the background; see {@link provenanceState}.
  await publishProvenanceStore(scope, graph);
  await publishSearchWindowHost(scope, graph);
  await publishSearchWindowCommands(scope);
  // Before `APP_REGISTRATIONS`, for the same reason the services are: the
  // pane registration below can make a `zotero:pref` window reload and load
  // our fragment at once, and its script resolves the host on load.
  await publishPreferencesHost(scope, graph, logRing);
  // The pane's Usage section (`P3-T16`), before the pane is registered, for
  // the same reason.
  await publishUsageHost(scope);
  // The item pane's AI summary section and its cache-invalidation observer
  // (`P3-T28`), after the services it reads.
  await publishSummarySection(scope, graph);
  // The summarize window's services and the resumed-jobs notice (`P3-T29`),
  // before the collection menu that opens the window is registered.
  await publishSummarizeCommands(scope, graph);
  // The report window's services (`P4-T19`), before the collection menu that
  // opens it; its teardown closes any report window still open.
  await publishReportWindowCommands(scope, graph);

  for (const register of APP_REGISTRATIONS) {
    await register(scope);
  }
}

/** Run the window-scoped registrations into one window's child scope. */
export async function registerWindowUI(
  scope: Scope,
  win: _ZoteroTypes.MainWindow,
): Promise<void> {
  for (const register of WINDOW_REGISTRATIONS) {
    await register(win)(scope);
  }
}
