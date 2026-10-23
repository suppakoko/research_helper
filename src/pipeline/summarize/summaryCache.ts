/**
 * The paper-summary cache — `docs/06` §11.2, `docs/07` §9.1–§9.4 (`P3-T26`).
 *
 * A summary is never paid for twice, and never served for an input other than
 * the one it was made from. The key is {@link summaryKey}
 * (`src/core/cache/keys.ts`) over `docs/06` §11.2's components, read as that
 * section's "Decided 2026-10-23" note records — with each keyed prompt's
 * `cacheEpoch`, not its version string, so a PATCH bump keeps the cache
 * (`docs/12` §17.2; owner, 2026-10-23, `plan/00` §6 item 273(a)); the
 * entries live in the one
 * cache's `summary` namespace (`cache_entry`, `docs/07` §8.3), so this module
 * adds no table and no migration.
 *
 * ## What is stored
 *
 * A {@link CachedSummary}: the payload, its `meta` block (`docs/12` §17.4,
 * with `docs/07` §5.2's field names) and the {@link RedactionMark}. Both halves
 * pass `redactRecord` (`src/core/provenance.ts`, the one gate for a persisted
 * record) before anything is written: the payload with no verbatim field,
 * because every string in it is model-written; `meta` with its identifiers
 * verbatim, because a 64-character content hash is exactly what `redact()`'s
 * catch-all would otherwise destroy. The value handed back on a miss is the
 * gated one, so the caller persists what the cache holds.
 *
 * **There is no `PaperSummary` type yet** (`P3-T25` declares it), so the
 * payload is a type parameter `P`. `P3-T25` instantiates it with
 * `PaperSummary` and builds `StoredSummary` (`docs/07` §5.2) from the entry:
 * `content` is {@link CachedSummary.summary}, and `promptId`, `promptVersion`,
 * `providerId`, `modelId`, `temperature`, `contentHash` and
 * `generatedAtEpochMs` are `meta`'s members of the same names.
 *
 * ## `cache.ignoreModel`
 *
 * Every stored summary also writes a small pointer under the model-free key
 * ({@link summaryKey} with `anyModel`), naming the entry it points at. With
 * the option on, a lookup that misses its exact key follows the pointer, so
 * summaries written *before* the option was switched on are found too. A hit
 * made by another model carries {@link CACHE_MIXED_MODEL_WARNING}. The provider
 * stays in the key: the option is about the model (`docs/07` §8.5's row).
 *
 * ## Tags (`docs/07` §9.3)
 *
 * `promptVersion:<promptId>@<MAJOR>.<MINOR>` for every prompt whose output
 * the summary contains — the version's cache line, which names its
 * `cacheEpoch` — then `model:`, `provider:`, `work:<workKey>` and
 * `schema:<PaperSummary schema version>`; the cache adds its own
 * `schema:<CACHE_SCHEMA_VERSION>`. The `work:` tag is what keeps a running
 * job's entries from eviction (`P3-T17`'s pinned tags, which escape the work
 * key with the same {@link encodeTagValue}).
 *
 * ## Failure is a miss
 *
 * A read that throws, or an entry whose `meta` does not describe the request,
 * is a miss; a write that throws is logged and the summary is still returned.
 * A summary that has been paid for is never lost to the cache.
 *
 * ## Callers
 *
 * `summarizeItem` (`P3-T25`) builds one {@link SummaryCache} per job over
 * `PipelineContext.cache`. {@link reconcilePromptVersions} and
 * {@link createSkipCachedGuard} are called once from `installServices`
 * (`src/bootstrap/container.ts`).
 */

import type { Cache } from "../../core/cache/cache";
import {
  encodeTagValue,
  stableStringify,
  summaryKey,
  type SummaryKeyInput,
} from "../../core/cache/keys";
import type { Clock } from "../../core/clock";
import type { JobRecord } from "../../core/jobQueue/jobRecord";
import type { Logger } from "../../core/logger";
import { redactRecord, type RedactionMark } from "../../core/provenance";
import type { ProviderId } from "../../model/ids";
import type { SourceTier } from "../../model/summary";
import { getPref, setPref } from "../../prefs";
import { promptCacheLine, type PromptId } from "../../prompts/index";
import type { InputScopeKind } from "../shared/privacyPolicy";

// ===========================================================================
// 1. Constants
// ===========================================================================

/**
 * `docs/06` §11.2's `PAPER_SUMMARY_SCHEMA_VERSION`: the `schemaVersion` const
 * of `src/prompts/schemas/paper-summary.v1.json` (a test holds the two equal).
 */
export const PAPER_SUMMARY_SCHEMA_VERSION = "paper-summary-v1";

/**
 * The warning code a hit made by another model carries under
 * `cache.ignoreModel` (`docs/06` §11.2: "a visible warning that the report
 * will mix model generations"). A machine code, not a user-visible string:
 * the surface that shows it owns the wording.
 */
export const CACHE_MIXED_MODEL_WARNING = "cache_mixed_model_generations";

/** The cache namespace summaries live in (`docs/07` §4.1, §9.2). */
export const SUMMARY_CACHE_NAMESPACE = "summary";

/** `docs/07` §9.3's prompt-version tag prefix. */
export const PROMPT_VERSION_TAG_PREFIX = "promptVersion:";

/** The prompts whose output is a `PaperSummary` (`docs/06` §11.2's `promptId`). */
export type SummaryPromptId = Extract<
  PromptId,
  "PAPER_SUMMARY_ABSTRACT" | "PAPER_SUMMARY_FULLTEXT" | "CHUNK_REDUCE"
>;

/**
 * Every prompt whose output a summary made by each {@link SummaryPromptId}
 * contains: a `CHUNK_REDUCE` summary was also shaped by `CHUNK_MAP`, so a
 * change to either must miss.
 */
export const SUMMARY_PROMPT_INPUTS: Readonly<
  Record<SummaryPromptId, readonly PromptId[]>
> = {
  PAPER_SUMMARY_ABSTRACT: ["PAPER_SUMMARY_ABSTRACT"],
  PAPER_SUMMARY_FULLTEXT: ["PAPER_SUMMARY_FULLTEXT"],
  CHUNK_REDUCE: ["CHUNK_REDUCE", "CHUNK_MAP"],
};

/** `meta`'s identifier fields, copied through the gate unchanged. */
const META_VERBATIM_KEYS: readonly string[] = [
  "itemKey",
  "workKey",
  "contentHash",
  "tier",
  "inputScopeKind",
  "promptId",
  "promptVersion",
  "schemaVersion",
  "providerId",
  "modelId",
];

/** The pointer's identifier fields, copied through the gate unchanged. */
const POINTER_VERBATIM_KEYS: readonly string[] = ["key", "modelId"];

// ===========================================================================
// 2. Types
// ===========================================================================

/** One summary request: what `summarizeItem` is about to send. */
export interface SummaryCacheRequest {
  readonly libraryID: number;
  /** The Zotero item key of the summarized (parent) item. */
  readonly itemKey: string;
  /**
   * `docs/07` §5.1's work key. A tag (`work:<workKey>`), never a key
   * component: it is how a running job pins its entries (§9.4 step 4).
   */
  readonly workKey: string;
  /**
   * `AcquiredSource.contentHash` — of the cleaned text actually sent. If the
   * caller cuts the text again before sending it, the hash of the cut text.
   */
  readonly contentHash: string;
  readonly tier: SourceTier;
  /** What the privacy policy let the model see (`planInputScopeKind`). */
  readonly inputScopeKind: InputScopeKind;
  readonly promptId: SummaryPromptId;
  /** Every user-message variable except the acquired text. */
  readonly promptMetadata: Readonly<Record<string, string>>;
  readonly providerId: ProviderId;
  readonly modelId: string;
  readonly temperature: number;
  /** Defaults to {@link PAPER_SUMMARY_SCHEMA_VERSION}. */
  readonly schemaVersion?: string;
}

/** `docs/12` §17.4's `meta` block, with `docs/07` §5.2's names. */
export interface SummaryCacheMeta {
  readonly libraryID: number;
  readonly itemKey: string;
  readonly workKey: string;
  readonly contentHash: string;
  readonly tier: SourceTier;
  readonly inputScopeKind: InputScopeKind;
  readonly promptId: SummaryPromptId;
  /** `PROMPT_VERSIONS[promptId]`: the exact prompt text that made it. */
  readonly promptVersion: string;
  /** Every keyed prompt's version (see {@link SUMMARY_PROMPT_INPUTS}). */
  readonly promptVersions: Readonly<Record<string, string>>;
  /**
   * Every keyed prompt's `cacheEpoch` — the key's prompt component, and what
   * a lookup compares (item 273(a)).
   */
  readonly promptCacheEpochs: Readonly<Record<string, number>>;
  readonly schemaVersion: string;
  readonly providerId: ProviderId;
  /** The model that produced the summary. */
  readonly modelId: string;
  readonly temperature: number;
  readonly generatedAtEpochMs: number;
}

/** The cached value: the payload, its `meta`, and what the gate changed. */
export interface CachedSummary<P> {
  readonly summary: P;
  readonly meta: SummaryCacheMeta;
  /** The mark of the pass that produced the stored value (`docs/09` §2.1). */
  readonly redaction: RedactionMark;
}

/** The model-free pointer `cache.ignoreModel` follows. */
interface AnyModelPointer {
  readonly anyModelPointer: 1;
  /** The exact key of the entry pointed at. */
  readonly key: string;
  readonly modelId: string;
}

/** What {@link SummaryCache.lookup} found. */
export type SummaryCacheLookup<P> =
  | {
      readonly hit: false;
      readonly key: string;
      /** `disabled`: `cache.enabled` is off, so nothing was read. */
      readonly reason: "disabled" | "miss";
    }
  | {
      readonly hit: true;
      readonly key: string;
      readonly entry: CachedSummary<P>;
      /** {@link CACHE_MIXED_MODEL_WARNING} when another model made it. */
      readonly warnings: readonly string[];
    };

/** What {@link SummaryCache.getOrSummarize} returns. */
export interface SummaryCacheResult<P> {
  readonly entry: CachedSummary<P>;
  /** `true`: no model call was made for this summary. */
  readonly fromCache: boolean;
  readonly warnings: readonly string[];
}

/** The summary cache one job uses. */
export interface SummaryCache {
  /** {@link summaryKey} for `request` under the shipped prompt versions. */
  keyOf(request: SummaryCacheRequest): string;
  /** The tags an entry for `request` carries. */
  tagsOf(request: SummaryCacheRequest): readonly string[];
  lookup<P>(request: SummaryCacheRequest): Promise<SummaryCacheLookup<P>>;
  /**
   * Gate `summary` and store it under `request`'s key, with the model-free
   * pointer. With `cache.enabled` off, nothing is written; the gated entry is
   * returned either way.
   */
  store<P>(request: SummaryCacheRequest, summary: P): Promise<CachedSummary<P>>;
  /**
   * {@link lookup}, and on a miss call `summarize` once and {@link store} its
   * result. Concurrent calls for one key share one `summarize`.
   */
  getOrSummarize<P>(
    request: SummaryCacheRequest,
    summarize: () => Promise<P>,
  ): Promise<SummaryCacheResult<P>>;
}

/** What {@link createSummaryCache} needs. */
export interface SummaryCacheDeps {
  /** `PipelineContext.cache`. */
  readonly cache: Cache;
  /**
   * `PROMPT_VERSIONS` (`src/prompts/bundled.ts`): recorded in `meta` and
   * tagged by line, never keyed.
   */
  readonly promptVersions: Readonly<Partial<Record<PromptId, string>>>;
  /**
   * `PROMPT_CACHE_EPOCHS` (`src/prompts/bundled.ts`): the key's prompt
   * component (`docs/06` §11.2 reading 3, corrected 2026-10-23).
   */
  readonly promptCacheEpochs: Readonly<Partial<Record<PromptId, number>>>;
  readonly clock: Pick<Clock, "now">;
  /** `cache.enabled`, on demand. Default: the preference. */
  readonly enabled?: () => boolean;
  /** `cache.ignoreModel`, on demand. Default: the preference. */
  readonly ignoreModel?: () => boolean;
  readonly logger?: Logger;
}

// ===========================================================================
// 3. Keys and tags
// ===========================================================================

/**
 * The tag-value escape, declared in `src/core/cache/keys.ts` so the job
 * runner's pinned tags can use it too (item 273(c)); re-exported here, where
 * the summary cache's callers have always found it.
 */
export { encodeTagValue };

/**
 * `promptVersion:<promptId>@<MAJOR>.<MINOR>` for a prompt at `version`.
 *
 * Qualified by the prompt: every prompt starts at `1.0.0`, so a bare
 * `promptVersion:1.0.0` would invalidate every prompt's entries at once.
 * And it names the version's **cache line** ({@link promptCacheLine}), not
 * the full version: the registry holds one `cacheEpoch` per line, so the
 * entries a PATCH bump keeps carry the same tag as the ones written after it,
 * and one later MINOR or MAJOR invalidation reaches them all (owner,
 * 2026-10-23, `plan/00` §6 item 273(a)).
 */
export function promptVersionTag(promptId: string, version: string): string {
  return `${PROMPT_VERSION_TAG_PREFIX}${encodeTagValue(promptId)}@${encodeTagValue(promptCacheLine(version))}`;
}

/**
 * The versions a summary made by `promptId` is keyed on.
 *
 * @throws RangeError when a needed prompt has no shipped version
 */
export function summaryPromptVersions(
  promptId: SummaryPromptId,
  shipped: Readonly<Partial<Record<PromptId, string>>>,
): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const id of SUMMARY_PROMPT_INPUTS[promptId]) {
    const version = shipped[id];
    if (version === undefined || version === "") {
      throw new RangeError(
        `[research-helper] summary cache: no shipped version for ${id}`,
      );
    }
    out[id] = version;
  }
  return out;
}

/**
 * The `cacheEpoch`s a summary made by `promptId` is keyed on.
 *
 * @throws RangeError when a needed prompt has no shipped epoch (a positive
 *   integer)
 */
export function summaryPromptCacheEpochs(
  promptId: SummaryPromptId,
  shipped: Readonly<Partial<Record<PromptId, number>>>,
): Readonly<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const id of SUMMARY_PROMPT_INPUTS[promptId]) {
    const epoch = shipped[id];
    if (epoch === undefined || !Number.isInteger(epoch) || epoch < 1) {
      throw new RangeError(
        `[research-helper] summary cache: no shipped cacheEpoch for ${id}`,
      );
    }
    out[id] = epoch;
  }
  return out;
}

function keyInput(
  request: SummaryCacheRequest,
  promptCacheEpochs: Readonly<Record<string, number>>,
): SummaryKeyInput {
  return {
    libraryID: request.libraryID,
    itemKey: request.itemKey,
    contentHash: request.contentHash,
    tier: request.tier,
    inputScopeKind: request.inputScopeKind,
    promptId: request.promptId,
    promptCacheEpochs,
    promptMetadata: request.promptMetadata,
    schemaVersion: request.schemaVersion ?? PAPER_SUMMARY_SCHEMA_VERSION,
    providerId: request.providerId,
    modelId: request.modelId,
    temperature: request.temperature,
  };
}

// ===========================================================================
// 4. Reading an entry back
// ===========================================================================

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPointer(value: unknown): value is AnyModelPointer {
  return (
    isRecord(value) &&
    value["anyModelPointer"] === 1 &&
    typeof value["key"] === "string" &&
    typeof value["modelId"] === "string"
  );
}

/**
 * Whether `value` is an entry made from exactly `request`'s input — every key
 * component, read back from `meta`. The key already says so; this catches a
 * row written by a build whose value shape differed. `sameModel: false` is
 * `cache.ignoreModel`'s reading, which lets the model differ.
 */
function isEntryFor<P>(
  value: unknown,
  request: SummaryCacheRequest,
  promptCacheEpochs: Readonly<Record<string, number>>,
  sameModel: boolean,
): value is CachedSummary<P> {
  if (!isRecord(value) || !("summary" in value) || !isRecord(value["meta"])) {
    return false;
  }
  const meta = value["meta"];
  return (
    meta["libraryID"] === request.libraryID &&
    meta["itemKey"] === request.itemKey &&
    meta["contentHash"] === request.contentHash &&
    meta["tier"] === request.tier &&
    meta["inputScopeKind"] === request.inputScopeKind &&
    meta["promptId"] === request.promptId &&
    stableStringify(meta["promptCacheEpochs"]) ===
      stableStringify(promptCacheEpochs) &&
    meta["schemaVersion"] ===
      (request.schemaVersion ?? PAPER_SUMMARY_SCHEMA_VERSION) &&
    meta["providerId"] === request.providerId &&
    meta["temperature"] === request.temperature &&
    typeof meta["modelId"] === "string" &&
    (!sameModel || meta["modelId"] === request.modelId)
  );
}

function sumMarks(a: RedactionMark, b: RedactionMark): RedactionMark {
  return {
    partlyRedacted: a.partlyRedacted || b.partlyRedacted,
    redactedStrings: a.redactedStrings + b.redactedStrings,
    droppedFields: a.droppedFields + b.droppedFields,
  };
}

// ===========================================================================
// 5. The cache
// ===========================================================================

/**
 * Build the summary cache one job uses.
 *
 * @param deps - the cache, the shipped prompt versions, a clock, and the two
 *   preferences (read on demand, `docs/07` §8.5.1)
 */
export function createSummaryCache(deps: SummaryCacheDeps): SummaryCache {
  const enabled = deps.enabled ?? (() => getPref("cacheEnabled"));
  const ignoreModel = deps.ignoreModel ?? (() => getPref("cacheIgnoreModel"));
  const inflight = new Map<string, Promise<SummaryCacheResult<unknown>>>();

  const versionsOf = (request: SummaryCacheRequest) =>
    summaryPromptVersions(request.promptId, deps.promptVersions);
  const epochsOf = (request: SummaryCacheRequest) =>
    summaryPromptCacheEpochs(request.promptId, deps.promptCacheEpochs);

  const keyOf = (request: SummaryCacheRequest): string =>
    summaryKey(keyInput(request, epochsOf(request)));

  const tagsOf = (request: SummaryCacheRequest): readonly string[] => {
    if (request.workKey === "") {
      throw new RangeError(
        "[research-helper] summary cache: workKey is empty, so a running job could not pin the entry",
      );
    }
    const versions = versionsOf(request);
    return [
      ...Object.entries(versions).map(([id, version]) =>
        promptVersionTag(id, version),
      ),
      `model:${encodeTagValue(request.modelId)}`,
      `provider:${encodeTagValue(request.providerId)}`,
      `work:${encodeTagValue(request.workKey)}`,
      `schema:${encodeTagValue(request.schemaVersion ?? PAPER_SUMMARY_SCHEMA_VERSION)}`,
    ];
  };

  /** One read; a read that throws is a miss. */
  const read = async (key: string): Promise<unknown> => {
    try {
      return await deps.cache.get<unknown>(SUMMARY_CACHE_NAMESPACE, key);
    } catch (error) {
      deps.logger?.warn("summary cache read failed; treated as a miss", {
        error: error instanceof Error ? error.name : typeof error,
      });
      return undefined;
    }
  };

  const lookup = async <P>(
    request: SummaryCacheRequest,
  ): Promise<SummaryCacheLookup<P>> => {
    const epochs = epochsOf(request);
    const key = summaryKey(keyInput(request, epochs));
    if (!enabled()) return { hit: false, key, reason: "disabled" };

    const exact = await read(key);
    if (isEntryFor<P>(exact, request, epochs, true)) {
      return { hit: true, key, entry: exact, warnings: [] };
    }
    if (exact !== undefined) {
      deps.logger?.warn(
        "summary cache entry does not describe its key; ignored",
        {
          itemKey: request.itemKey,
        },
      );
    }

    if (ignoreModel()) {
      const pointer = await read(
        summaryKey(keyInput(request, epochs), { anyModel: true }),
      );
      if (isPointer(pointer) && pointer.key !== key) {
        const other = await read(pointer.key);
        if (isEntryFor<P>(other, request, epochs, false)) {
          const mixed = other.meta.modelId !== request.modelId;
          if (mixed) {
            deps.logger?.warn(
              "summary served from another model (cache.ignoreModel)",
              {
                itemKey: request.itemKey,
                requestedModel: request.modelId,
                servedModel: other.meta.modelId,
              },
            );
          }
          return {
            hit: true,
            key: pointer.key,
            entry: other,
            warnings: mixed ? [CACHE_MIXED_MODEL_WARNING] : [],
          };
        }
      }
    }
    return { hit: false, key, reason: "miss" };
  };

  const store = async <P>(
    request: SummaryCacheRequest,
    summary: P,
  ): Promise<CachedSummary<P>> => {
    const versions = versionsOf(request);
    const epochs = epochsOf(request);
    const key = summaryKey(keyInput(request, epochs));
    const meta: SummaryCacheMeta = {
      libraryID: request.libraryID,
      itemKey: request.itemKey,
      workKey: request.workKey,
      contentHash: request.contentHash,
      tier: request.tier,
      inputScopeKind: request.inputScopeKind,
      promptId: request.promptId,
      promptVersion: versions[request.promptId] as string,
      promptVersions: versions,
      promptCacheEpochs: epochs,
      schemaVersion: request.schemaVersion ?? PAPER_SUMMARY_SCHEMA_VERSION,
      providerId: request.providerId,
      modelId: request.modelId,
      temperature: request.temperature,
      generatedAtEpochMs: deps.clock.now(),
    };
    // The one gate (`docs/09` §2.1): the payload with nothing verbatim — it is
    // all model-written — and `meta` with its identifiers verbatim.
    const gatedSummary = redactRecord(summary);
    const gatedMeta = redactRecord(meta, { verbatimKeys: META_VERBATIM_KEYS });
    const entry: CachedSummary<P> = {
      summary: gatedSummary.record,
      meta: gatedMeta.record,
      redaction: sumMarks(gatedSummary.mark, gatedMeta.mark),
    };
    if (!enabled()) return entry;

    const tags = tagsOf(request);
    const pointer = redactRecord<AnyModelPointer>(
      { anyModelPointer: 1, key, modelId: request.modelId },
      { verbatimKeys: POINTER_VERBATIM_KEYS },
    ).record;
    try {
      await deps.cache.set(SUMMARY_CACHE_NAMESPACE, key, entry, { tags });
      await deps.cache.set(
        SUMMARY_CACHE_NAMESPACE,
        summaryKey(keyInput(request, epochs), { anyModel: true }),
        pointer,
        { tags },
      );
    } catch (error) {
      deps.logger?.warn("summary cache write failed; the summary is kept", {
        itemKey: request.itemKey,
        error: error instanceof Error ? error.name : typeof error,
      });
    }
    return entry;
  };

  const getOrSummarize = <P>(
    request: SummaryCacheRequest,
    summarize: () => Promise<P>,
  ): Promise<SummaryCacheResult<P>> => {
    const key = keyOf(request);
    const running = inflight.get(key);
    if (running !== undefined) {
      return running as Promise<SummaryCacheResult<P>>;
    }
    const work = (async (): Promise<SummaryCacheResult<P>> => {
      const found = await lookup<P>(request);
      if (found.hit) {
        return {
          entry: found.entry,
          fromCache: true,
          warnings: found.warnings,
        };
      }
      const entry = await store(request, await summarize());
      return { entry, fromCache: false, warnings: [] };
    })();
    inflight.set(key, work);
    const forget = (): void => {
      if (inflight.get(key) === work) inflight.delete(key);
    };
    work.then(forget, forget);
    return work;
  };

  return {
    keyOf,
    tagsOf,
    lookup,
    store,
    getOrSummarize,
  };
}

// ===========================================================================
// 6. §9.3 trigger 1: the startup prompt-version comparison
// ===========================================================================

/** What {@link reconcilePromptVersions} needs. */
export interface PromptVersionReconciliationDeps {
  readonly cache: Pick<Cache, "invalidateByTag">;
  /** `PROMPT_VERSIONS`, the versions this build ships. */
  readonly shipped: Readonly<Record<string, string>>;
  /** `cache.lastSeenPromptVersions`. Default: the preference. */
  readonly readLastSeen?: () => string;
  /** Write `cache.lastSeenPromptVersions`. Default: the preference. */
  readonly writeLastSeen?: (json: string) => void;
  readonly logger?: Logger;
}

/** What {@link reconcilePromptVersions} did. */
export interface PromptVersionReconciliation {
  /** Each last-seen prompt whose version is no longer the shipped one. */
  readonly changed: readonly {
    readonly promptId: string;
    readonly from: string;
    /** `undefined`: the prompt is no longer shipped. */
    readonly to: string | undefined;
    /**
     * Whether its entries were invalidated: `false` for a PATCH-only change
     * (same `MAJOR.MINOR`, so the same `cacheEpoch`), whose entries are kept
     * (`docs/12` §17.2); `true` for a MINOR or MAJOR change, or a prompt no
     * longer shipped.
     */
    readonly invalidated: boolean;
  }[];
  /** Entries removed, summed over every `invalidateByTag`. */
  readonly invalidated: number;
  /** Whether the preference was written (it is, once, when the sets differ). */
  readonly wrote: boolean;
}

/** The last-seen set, or `{}` for a value that is not a string→string object. */
function parseLastSeen(
  json: string,
  logger: Logger | undefined,
): Record<string, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    parsed = undefined;
  }
  if (
    isRecord(parsed) &&
    Object.values(parsed).every((value) => typeof value === "string")
  ) {
    return parsed as Record<string, string>;
  }
  logger?.warn(
    "cache.lastSeenPromptVersions is not a prompt-to-version object; read as empty",
  );
  return {};
}

/**
 * `docs/07` §9.3 trigger 1, run once at startup after the cache is built:
 * compare the shipped prompt versions with `cache.lastSeenPromptVersions`,
 * call `invalidateByTag(promptVersion:<id>@<old MAJOR.MINOR>)` for each
 * prompt whose `MAJOR.MINOR` changed (or that is no longer shipped), then
 * write the shipped set once.
 *
 * **A PATCH-only change invalidates nothing** (owner, 2026-10-23, `plan/00`
 * §6 item 273(a)): the registry keeps `cacheEpoch` across a PATCH bump and
 * the key carries the epoch, so the entries are still correct and `docs/12`
 * §17.2 says they are retained. The new version is still written, and still
 * reported in `changed` (with `invalidated: false`).
 *
 * Only cache entries go: a Zotero note is never touched (§9.3). If an
 * invalidation throws, nothing is written, so the next start tries again —
 * and nothing stale is served meanwhile, because a MINOR or MAJOR bump raises
 * the `cacheEpoch` every key carries.
 *
 * @returns what changed, how many entries went, and whether the set was written
 */
export async function reconcilePromptVersions(
  deps: PromptVersionReconciliationDeps,
): Promise<PromptVersionReconciliation> {
  const readLastSeen =
    deps.readLastSeen ?? (() => getPref("cacheLastSeenPromptVersions"));
  const writeLastSeen =
    deps.writeLastSeen ??
    ((json: string) => setPref("cacheLastSeenPromptVersions", json));

  const lastSeen = parseLastSeen(readLastSeen(), deps.logger);
  const changed: {
    promptId: string;
    from: string;
    to: string | undefined;
    invalidated: boolean;
  }[] = [];
  for (const [promptId, from] of Object.entries(lastSeen)) {
    const to = deps.shipped[promptId];
    if (to === from) continue;
    changed.push({
      promptId,
      from,
      to,
      invalidated:
        to === undefined || promptCacheLine(to) !== promptCacheLine(from),
    });
  }

  let invalidated = 0;
  for (const change of changed) {
    if (!change.invalidated) continue;
    invalidated += await deps.cache.invalidateByTag(
      promptVersionTag(change.promptId, change.from),
    );
  }

  const next = stableStringify(deps.shipped);
  const wrote = stableStringify(lastSeen) !== next;
  if (wrote) writeLastSeen(next);
  if (changed.length > 0) {
    deps.logger?.info(
      "prompt versions changed; their cache entries invalidated",
      {
        changed: changed
          .map(
            ({ promptId, from, to, invalidated: gone }) =>
              `${promptId} ${from}->${to ?? "-"}${gone ? "" : " (patch, kept)"}`,
          )
          .join(","),
        invalidated,
      },
    );
  }
  return { changed, invalidated, wrote };
}

// ===========================================================================
// 7. `ResumeGuards.skipCached` (`docs/07` §7.6)
// ===========================================================================

/**
 * Whether one work key of an interrupted job needs no further work — its
 * summary is cached under the key the resumed run would compute, and nothing
 * remains to be written for it. Only the summarize pipeline (`P3-T29`) can
 * answer that: the key needs the acquired text's hash, which needs the item
 * read again.
 */
export type CachedWorkProbe = (
  record: JobRecord,
  workKey: string,
) => Promise<boolean>;

/** `docs/07` §7.6's `SummarizeCheckpoint`, the members this guard reads. */
interface WorkListCheckpoint {
  readonly version: 1;
  readonly pending: readonly string[];
  readonly completed: readonly string[];
}

function isWorkListCheckpoint(value: unknown): value is WorkListCheckpoint {
  const isStrings = (list: unknown): boolean =>
    Array.isArray(list) && list.every((entry) => typeof entry === "string");
  return (
    isRecord(value) &&
    value["version"] === 1 &&
    isStrings(value["pending"]) &&
    isStrings(value["completed"])
  );
}

/** What {@link createSkipCachedGuard} needs. */
export interface SkipCachedGuardDeps {
  /** Absent until `P3-T29` supplies one: then nothing is skipped. */
  readonly probe?: CachedWorkProbe;
  /** `cache.enabled`, on demand. Default: the preference. */
  readonly enabled?: () => boolean;
  readonly logger?: Logger;
}

/**
 * `ResumeGuards.skipCached`: move the pending work keys the probe says are
 * done to `completed`, so the guards after it (`confirm`, `ceilings`) judge
 * only what is left, and return the checkpoint to resume from.
 *
 * **Without a probe, or for a checkpoint that is not `docs/07` §7.6's work
 * list, the checkpoint is returned unchanged.** That is the safe direction:
 * every remaining item stays pending, so the spend guards may over-count
 * (never under-count) — and at run time a cached item still costs no model
 * call, because `summarizeItem` looks it up by its full key first. A probe
 * that throws for one key leaves that key pending.
 */
export function createSkipCachedGuard(
  deps: SkipCachedGuardDeps = {},
): (record: JobRecord) => Promise<unknown> {
  const enabled = deps.enabled ?? (() => getPref("cacheEnabled"));
  return async (record: JobRecord): Promise<unknown> => {
    const checkpoint = record.checkpoint;
    const probe = deps.probe;
    if (
      probe === undefined ||
      !enabled() ||
      !isWorkListCheckpoint(checkpoint)
    ) {
      return checkpoint;
    }
    const pending: string[] = [];
    const skipped: string[] = [];
    for (const workKey of checkpoint.pending) {
      let done = false;
      try {
        done = await probe(record, workKey);
      } catch (error) {
        deps.logger?.warn("skipCached probe failed; the item stays pending", {
          jobId: record.id,
          error: error instanceof Error ? error.name : typeof error,
        });
      }
      (done ? skipped : pending).push(workKey);
    }
    return {
      ...checkpoint,
      pending,
      completed: [...checkpoint.completed, ...skipped],
    };
  };
}
