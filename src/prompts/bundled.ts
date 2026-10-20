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
 * Callers, none yet: `summarizeItem` (`P3-T25`), the cache key (`P3-T26`) and
 * `relevanceScreen` (`P3-T27`).
 */

import chunkMapV100 from "./chunk-map.v1.0.0.md" with { type: "text" };
import chunkReduceV100 from "./chunk-reduce.v1.0.0.md" with { type: "text" };
import {
  createPromptRegistry,
  type PromptId,
  type PromptRegistry,
  type PromptSourceFile,
} from "./index";
import paperSummaryAbstractV100 from "./paper-summary-abstract.v1.0.0.md" with { type: "text" };
import paperSummaryFulltextV100 from "./paper-summary-fulltext.v1.0.0.md" with { type: "text" };
import relevanceScreenV100 from "./relevance-screen.v1.0.0.md" with { type: "text" };

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
]);

/** The registry over {@link PROMPT_SOURCE_FILES}, built once. */
export const PROMPT_REGISTRY: PromptRegistry =
  createPromptRegistry(PROMPT_SOURCE_FILES);

/**
 * Each prompt's active version string (`docs/12` §17.4's
 * `PROMPT_VERSIONS[promptId]`). `P3-T26` keys and tags the cache on these.
 */
export const PROMPT_VERSIONS: Readonly<Record<PromptId, string>> =
  PROMPT_REGISTRY.versions;
