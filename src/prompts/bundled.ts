/**
 * The shipped prompt files, bundled — `P3-T24` step 7, `docs/12` §17.3
 * (decided 2026-10-20, `plan/00` §6 item 237).
 *
 * This is the one module that imports a `.md` file. Each import carries the
 * attribute `with { type: "text" }`, so esbuild inlines the file as a string in
 * both the plugin build and the scaffold's in-Zotero test build, with no
 * loader configured in either; `typings/prompts.d.ts` types the import.
 *
 * **Unit tests must not import this module.** Vitest cannot import a `.md`
 * file in either form, which is why the registry itself (`./index`) takes the
 * text as {@link PromptSourceFile}s: the unit tests read the files from disk
 * and pass them in. The bundled copies are checked inside Zotero by
 * `test/integration/prompts.spec.ts`.
 *
 * The registry is built once, when this module is first evaluated. A malformed
 * or missing file throws `PromptRegistryError` at that point, listing
 * every problem.
 *
 * Adding a prompt version: add its file, one import below, one entry in
 * {@link PROMPT_SOURCE_FILES}, and point `PROMPT_FILE_NAMES` in `./index` at it
 * when it becomes the active one. Keep the superseded file and its import, so
 * a cached output can still be explained (`docs/12` §17.5). The `fileName`
 * strings repeat the import paths because an import path must be a literal;
 * `createPromptRegistry` rejects a name that disagrees with the file's `id`
 * and `version`.
 *
 * Callers: `registerUI.ts` loads {@link PROMPT_VERSIONS} lazily for the
 * startup prompt-version comparison (`P3-T26`). Still to come:
 * `summarizeItem` (`P3-T25`), which passes {@link PROMPT_VERSIONS} and
 * {@link PROMPT_CACHE_EPOCHS} to the summary cache, and `relevanceScreen`
 * (`P3-T27`). Phase 4's synthesis stages read the trend prompts through
 * {@link PROMPT_REGISTRY}: `THEME_CLUSTER` (`P4-T05`), `THEME_MERGE`
 * (`P4-T06`), `CLUSTER_REDUCE` and `CLUSTER_REDUCE_MERGE` (`P4-T07`),
 * `TREND_REPORT_EN`/`_KO` (`P4-T08`) and `SELF_CRITIQUE` (`P4-T09`).
 * `THEME_MERGE` and `CLUSTER_REDUCE_MERGE` are approved as drafted, and
 * `THEME_CLUSTER`'s three numbers moved to its user text (decided
 * 2026-10-26, owner, `plan/00` §6 item 290(a) and (b)). `TREND_REPORT_EN` and
 * `TREND_REPORT_KO` are the first prompts with a superseded version in the
 * bundle: 1.0.1 raised their output ceilings only (owner, `plan/00` §6 item
 * 311(c), 2026-10-30). `COLLECTION_PROFILE` is read through
 * {@link PROMPT_REGISTRY} by the recommend pipeline (`P5-T22`, `P5-T25`).
 * `AUDIO_SCRIPT_EN` and `AUDIO_SCRIPT_KO` are read by the audio script pass
 * (`src/pipeline/audioReport/script.ts`, `P6-T07`); they joined on 2026-11-17
 * (owner, `plan/00` §6 item 382).
 */

import audioScriptEnV100 from "./audio-script-en.v1.0.0.md" with { type: "text" };
import audioScriptKoV100 from "./audio-script-ko.v1.0.0.md" with { type: "text" };
import chunkMapV100 from "./chunk-map.v1.0.0.md" with { type: "text" };
import chunkReduceV100 from "./chunk-reduce.v1.0.0.md" with { type: "text" };
import clusterReduceMergeV100 from "./cluster-reduce-merge.v1.0.0.md" with { type: "text" };
import clusterReduceV100 from "./cluster-reduce.v1.0.0.md" with { type: "text" };
import collectionProfileV100 from "./collection-profile.v1.0.0.md" with { type: "text" };
import {
  createPromptRegistry,
  type PromptId,
  type PromptRegistry,
  type PromptSourceFile,
} from "./index";
import paperSummaryAbstractV100 from "./paper-summary-abstract.v1.0.0.md" with { type: "text" };
import paperSummaryFulltextV100 from "./paper-summary-fulltext.v1.0.0.md" with { type: "text" };
import relevanceScreenV100 from "./relevance-screen.v1.0.0.md" with { type: "text" };
import selfCritiqueV100 from "./self-critique.v1.0.0.md" with { type: "text" };
import themeClusterV100 from "./theme-cluster.v1.0.0.md" with { type: "text" };
import themeMergeV100 from "./theme-merge.v1.0.0.md" with { type: "text" };
import trendReportEnV100 from "./trend-report-en.v1.0.0.md" with { type: "text" };
import trendReportEnV101 from "./trend-report-en.v1.0.1.md" with { type: "text" };
import trendReportKoV100 from "./trend-report-ko.v1.0.0.md" with { type: "text" };
import trendReportKoV101 from "./trend-report-ko.v1.0.1.md" with { type: "text" };

/** Every bundled prompt file, active or superseded. */
export const PROMPT_SOURCE_FILES: readonly PromptSourceFile[] = Object.freeze([
  { fileName: "relevance-screen.v1.0.0.md", text: relevanceScreenV100 },
  {
    fileName: "paper-summary-abstract.v1.0.0.md",
    text: paperSummaryAbstractV100,
  },
  {
    fileName: "paper-summary-fulltext.v1.0.0.md",
    text: paperSummaryFulltextV100,
  },
  { fileName: "chunk-map.v1.0.0.md", text: chunkMapV100 },
  { fileName: "chunk-reduce.v1.0.0.md", text: chunkReduceV100 },
  { fileName: "theme-cluster.v1.0.0.md", text: themeClusterV100 },
  { fileName: "cluster-reduce.v1.0.0.md", text: clusterReduceV100 },
  { fileName: "trend-report-en.v1.0.0.md", text: trendReportEnV100 },
  { fileName: "trend-report-ko.v1.0.0.md", text: trendReportKoV100 },
  // 1.0.1: the ceiling raised, a PATCH; 1.0.0 stays so a stored report naming
  // it can be explained (owner, plan/00 §6 item 311(c); docs/12 §17.3, §17.5).
  { fileName: "trend-report-en.v1.0.1.md", text: trendReportEnV101 },
  { fileName: "trend-report-ko.v1.0.1.md", text: trendReportKoV101 },
  { fileName: "self-critique.v1.0.0.md", text: selfCritiqueV100 },
  { fileName: "collection-profile.v1.0.0.md", text: collectionProfileV100 },
  { fileName: "theme-merge.v1.0.0.md", text: themeMergeV100 },
  {
    fileName: "cluster-reduce-merge.v1.0.0.md",
    text: clusterReduceMergeV100,
  },
  { fileName: "audio-script-en.v1.0.0.md", text: audioScriptEnV100 },
  { fileName: "audio-script-ko.v1.0.0.md", text: audioScriptKoV100 },
]);

/** The registry over {@link PROMPT_SOURCE_FILES}, built once. */
export const PROMPT_REGISTRY: PromptRegistry =
  createPromptRegistry(PROMPT_SOURCE_FILES);

/**
 * Each prompt's active version string (`docs/12` §17.4's
 * `PROMPT_VERSIONS[promptId]`). The summary cache records it in every entry's
 * `meta` and tags by its `MAJOR.MINOR` line; the startup prompt-version
 * comparison stores it (`P3-T26`).
 */
export const PROMPT_VERSIONS: Readonly<Record<PromptId, string>> =
  PROMPT_REGISTRY.versions;

/**
 * Each prompt's active `cacheEpoch`: the summary cache key's prompt component,
 * so a PATCH bump keeps cached summaries (`docs/12` §17.2 and §17.4, corrected
 * 2026-10-23, owner, `plan/00` §6 item 273(a)).
 */
export const PROMPT_CACHE_EPOCHS: Readonly<Record<PromptId, number>> =
  PROMPT_REGISTRY.cacheEpochs;
