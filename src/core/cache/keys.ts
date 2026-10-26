/**
 * `docs/07` §9.1's hashing mechanics: {@link stableStringify},
 * {@link CACHE_SCHEMA_VERSION}, and one generic key helper (`P3-T33`).
 *
 * The per-purpose key builders §9.1 also sketches (`sourceResponseKey`,
 * `embeddingKey`, `llmCompletionKey`) belong to the cards that cache those
 * things. {@link summaryKey} is `P3-T26`'s: `docs/06` §11.2's components,
 * read as that section's "Decided 2026-10-23" note records — each keyed
 * prompt's `cacheEpoch`, not its full version string, so a PATCH bump keeps
 * cached summaries (corrected 2026-10-23, owner, `plan/00` §6 item 273(a)).
 * {@link encodeTagValue} is the one escape for a cache tag's value: the
 * summary cache and the job runner's pinned tags both use it (item 273(c)).
 *
 * The synthesis keys — {@link themeClusteringKey}, {@link themeAnalysisKey}
 * and {@link reportKey}, `docs/06` §11.2's `tc`, `cr` and `rp` — are
 * `P4-T17`'s, typed by `docs/07` §9.1's "Decided 2026-10-27" block and read
 * as `docs/06` §11.2's readings of the same day. Their caller is
 * `src/pipeline/trendReport/trendReportPipeline.ts` (`P4-T18`), which probes
 * each key before its stage and stores after it; nothing calls them before
 * that card lands.
 *
 * ## Why SHA-256 is computed here, synchronously
 *
 * §9.1's builders are synchronous (`return sha256([...].join("|"))`), and
 * `crypto.subtle.digest` is not. `core/` may import only `model/`, so no
 * platform hash can be imported either. {@link sha256Hex} is FIPS 180-4's
 * SHA-256 over the UTF-8 bytes of a string, checked in
 * `test/unit/core/cache.test.ts` against Node's `crypto` and the standard
 * test vectors. It is a cache key, not a security boundary.
 */

import type { ProviderId } from "../../model/ids";
import type { SourceTier } from "../../model/summary";
import type { ReportLanguage } from "../../model/trend";

/** Bumped whenever the shape of a cached value changes. */
export const CACHE_SCHEMA_VERSION = 1;

/**
 * JSON with every object's keys sorted, recursively — so `{a:1,b:2}` and
 * `{b:2,a:1}` are one string (§9.1: "Without it … the hit rate silently
 * collapses").
 *
 * Follows `JSON.stringify` otherwise: `toJSON` is honoured, an `undefined`,
 * function or symbol member is left out of an object and written `null` in an
 * array, and a non-finite number is `null`. Array order is kept: it is data.
 *
 * @throws TypeError for a `bigint`, or for a cycle — neither has a JSON form
 */
export function stableStringify(value: unknown): string {
  const out = encode(value, new Set<object>());
  return out ?? "null";
}

/** One value's canonical JSON, or `undefined` for a value JSON leaves out. */
function encode(value: unknown, path: Set<object>): string | undefined {
  if (value !== null && typeof value === "object") {
    const withToJson = value as { toJSON?: unknown };
    if (typeof withToJson.toJSON === "function") {
      return encode((withToJson.toJSON as () => unknown).call(value), path);
    }
  }
  switch (typeof value) {
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "number":
      return Number.isFinite(value) ? JSON.stringify(value) : "null";
    case "bigint":
      throw new TypeError(
        "[research-helper] stableStringify cannot encode a bigint",
      );
    case "undefined":
    case "function":
    case "symbol":
      return undefined;
    default:
      break;
  }
  if (value === null) return "null";
  const object = value as object;
  if (path.has(object)) {
    throw new TypeError(
      "[research-helper] stableStringify cannot encode a cycle",
    );
  }
  path.add(object);
  try {
    if (Array.isArray(object)) {
      return `[${(object as unknown[])
        .map((item) => encode(item, path) ?? "null")
        .join(",")}]`;
    }
    const record = object as Record<string, unknown>;
    const members: string[] = [];
    for (const name of Object.keys(record).sort()) {
      const encoded = encode(record[name], path);
      if (encoded !== undefined) {
        members.push(`${JSON.stringify(name)}:${encoded}`);
      }
    }
    return `{${members.join(",")}}`;
  } finally {
    path.delete(object);
  }
}

/**
 * The generic key: the SHA-256 hex digest of
 * `stableStringify(["v<CACHE_SCHEMA_VERSION>", kind, ...parts])`.
 *
 * An array rather than §9.1's `parts.join("|")`, so a part that contains a
 * `|` cannot make two different part lists one key. `CACHE_SCHEMA_VERSION` is
 * the first component, so a bump makes every key miss (§9.3 trigger 4).
 *
 * @param kind - what is keyed, e.g. `"source"`; one word per key builder
 * @param parts - everything that could change the cached value (§9.1)
 */
export function cacheKey(kind: string, ...parts: readonly unknown[]): string {
  return sha256Hex(
    stableStringify([`v${String(CACHE_SCHEMA_VERSION)}`, kind, ...parts]),
  );
}

// ---------------------------------------------------------------------------
// The summary key — docs/06 §11.2 (`P3-T26`)
// ---------------------------------------------------------------------------

/** {@link summaryKey}'s `kind`: §11.2's `'ps'` namespace component. */
export const SUMMARY_KEY_KIND = "ps";

/**
 * Everything `docs/06` §11.2 keys a paper summary on, read as that section's
 * "Decided 2026-10-23" note records. Every member is load-bearing: changing
 * any one of them must miss.
 */
export interface SummaryKeyInput {
  readonly libraryID: number;
  /** The Zotero item key of the summarized (parent) item. */
  readonly itemKey: string;
  /**
   * `AcquiredSource.contentHash`: the hash of the **cleaned** text actually
   * sent (`docs/06` §4.1 runs before it is taken), never of the file, the raw
   * extractor text or `dateModified`. If a later stage cuts the text again
   * before sending it, this must be the hash of the cut text.
   */
  readonly contentHash: string;
  /** §11.2's `src.tier`: an abstract summary never satisfies a full-text request. */
  readonly tier: SourceTier;
  /**
   * `docs/07` §5.2's `SummaryInputScope["kind"]` — what the privacy policy
   * let the model see (`P3-T15`'s `planInputScopeKind`).
   */
  readonly inputScopeKind: string;
  /** `PAPER_SUMMARY_ABSTRACT` | `PAPER_SUMMARY_FULLTEXT` | `CHUNK_REDUCE`. */
  readonly promptId: string;
  /**
   * The `cacheEpoch` of every prompt whose output the summary contains:
   * `promptId`'s own (required), and `CHUNK_MAP`'s too for a `CHUNK_REDUCE`
   * summary. Not the full version string: the registry holds `cacheEpoch`
   * equal across a PATCH bump, so a PATCH bump keeps the key (`docs/12`
   * §17.2; owner, 2026-10-23, `plan/00` §6 item 273(a); this was
   * `promptVersions`, keyed on the version strings).
   */
  readonly promptCacheEpochs: Readonly<Record<string, number>>;
  /**
   * Every user-message variable of the prompt except the acquired text —
   * title, authors, year, venue, item type, DOI, tags, tier, completeness
   * note — because the model is shown them too.
   */
  readonly promptMetadata: Readonly<Record<string, string>>;
  /** `PaperSummary`'s schema version, e.g. `"paper-summary-v1"`. */
  readonly schemaVersion: string;
  readonly providerId: ProviderId;
  /** The pinned, dated model identifier the request names. */
  readonly modelId: string;
  /** The sampling temperature the request sends. */
  readonly temperature: number;
}

/** How {@link summaryKey} is asked for its key. */
export interface SummaryKeyOptions {
  /**
   * `cache.ignoreModel`'s key: the model component is replaced by `null`, a
   * value no model identifier (a string) can equal. The provider stays.
   */
  readonly anyModel?: boolean;
}

function requireText(name: string, value: string): void {
  if (value === "") {
    throw new RangeError(`[research-helper] summaryKey: ${name} is empty`);
  }
}

/**
 * The summary cache key: SHA-256 of `stableStringify` over
 * `["v<CACHE_SCHEMA_VERSION>", "ps", …§11.2's components]`, in §11.2's
 * order, with the input scope kind after the tier and the prompt metadata
 * after the schema version.
 *
 * Not `StoredSummary.id` (`workKey:promptVersion:modelId`, `docs/07` §5.2):
 * that id names "the current summary of this work"; this key names one exact
 * input.
 *
 * @throws RangeError for an empty identifying component, a
 *   `promptCacheEpochs` map without a positive integer for `promptId`, or a
 *   non-finite temperature — a key built from a hole would match another hole
 */
export function summaryKey(
  input: SummaryKeyInput,
  options: SummaryKeyOptions = {},
): string {
  requireText("itemKey", input.itemKey);
  requireText("contentHash", input.contentHash);
  requireText("promptId", input.promptId);
  requireText("schemaVersion", input.schemaVersion);
  requireText("modelId", input.modelId);
  const ownEpoch = input.promptCacheEpochs[input.promptId];
  if (ownEpoch === undefined || !Number.isInteger(ownEpoch) || ownEpoch < 1) {
    throw new RangeError(
      `[research-helper] summaryKey: no cacheEpoch for ${input.promptId}`,
    );
  }
  if (!Number.isFinite(input.temperature)) {
    throw new RangeError(
      "[research-helper] summaryKey: temperature is not finite",
    );
  }
  return cacheKey(
    SUMMARY_KEY_KIND,
    input.libraryID,
    input.itemKey,
    input.contentHash,
    input.tier,
    input.inputScopeKind,
    input.promptId,
    input.promptCacheEpochs,
    input.schemaVersion,
    input.promptMetadata,
    input.providerId,
    options.anyModel === true ? null : input.modelId,
    input.temperature,
  );
}

// ---------------------------------------------------------------------------
// Tag values — docs/07 §9.3, docs/06 §11.2 reading 8
// ---------------------------------------------------------------------------

/**
 * A tag value with `%` and `,` escaped: `cache_entry.tags` is comma-joined,
 * so a comma inside a value (a DOI may hold one) would split the tag, and the
 * cache refuses a tag that contains one.
 *
 * The one escape for a tag's value. It lives here, in `core/`, so that both
 * the summary cache (`src/pipeline/summarize/summaryCache.ts`, which
 * re-exports it) and the job runner's pinned tags (`RunningWork.pinnedTags`
 * in `src/core/jobQueue/queue.ts`) apply it: a `work:` tag written one way
 * and pinned another would leave a running job's entries evictable
 * (owner, 2026-10-23, `plan/00` §6 item 273(c)).
 *
 * @param value - any string
 * @returns `value` with `%` written `%25` and `,` written `%2C`
 */
export function encodeTagValue(value: string): string {
  return value.replace(/%/g, "%25").replace(/,/g, "%2C");
}

// ---------------------------------------------------------------------------
// The synthesis keys — docs/06 §11.2's `tc`, `cr`, `rp` (`P4-T17`)
// ---------------------------------------------------------------------------

/**
 * `docs/06` §11.2's coarse namespaces — clustering, theme analysis, report —
 * each used as its key's `kind` in {@link cacheKey}.
 */
export type SynthesisKeyKind = "tc" | "cr" | "rp";

/**
 * The prompts the clustering stage can call, and so the `cacheEpoch`s `tc`
 * carries: `THEME_MERGE` too, because the stage may run two-stage (`docs/06`
 * §8.4).
 */
export const THEME_CLUSTERING_KEY_PROMPTS = [
  "THEME_CLUSTER",
  "THEME_MERGE",
] as const;

/**
 * The prompts one theme's analysis can call, and so the `cacheEpoch`s `cr`
 * carries: `CLUSTER_REDUCE_MERGE` too, for a theme split into sub-batches
 * (`docs/06` §8.4, last paragraph).
 */
export const THEME_ANALYSIS_KEY_PROMPTS = [
  "CLUSTER_REDUCE",
  "CLUSTER_REDUCE_MERGE",
] as const;

/** The report prompt each language runs (`docs/12` §10, §11). */
const REPORT_PROMPT_BY_LANGUAGE: Readonly<Record<ReportLanguage, string>> = {
  en: "TREND_REPORT_EN",
  ko: "TREND_REPORT_KO",
};

/** The critique prompt; `rp` carries its epoch only when the critique runs. */
const SELF_CRITIQUE_PROMPT = "SELF_CRITIQUE";

/** `docs/07` §9.3's prompt tag prefix, as `summaryCache.ts` writes it. */
const PROMPT_LINE_TAG_PREFIX = "promptVersion:";

/**
 * One input of a stage: an item key (or, for `rp`'s theme analyses, a theme
 * id) and the hash of exactly what the stage's call is shown for it — the
 * digest block for `tc`, the `PaperSummary` as put in `{{SUMMARIES_JSON}}`
 * for `cr`, the `ThemeAnalysis` as put in `{{THEME_ANALYSES_JSON}}` for `rp`
 * (`docs/06` §11.2, reading 2 of 2026-10-27). The caller hashes with
 * {@link sha256Hex}.
 */
export interface SynthesisInputHash {
  readonly id: string;
  readonly hash: string;
}

/** What every call of a stage sends besides its prompt text. */
export interface SynthesisCallSettings {
  /** The pinned, dated model identifier the requests name. */
  readonly modelId: string;
  /** The sampling temperature the requests send. */
  readonly temperature: number;
  /** `ChatRequest.effort` as sent; absent when none is sent. */
  readonly effort?: string;
}

/**
 * Every other user-message variable of the stage's prompts (`USER_TOPIC`,
 * the counts, `SOURCES`, …), and any code-side setting that changes what the
 * calls are shown (`docs/06` §8.4's batch size, a sub-batch budget). Keyed as
 * given; it is never a place for a credential.
 */
export type SynthesisStageInputs = Readonly<
  Record<string, string | number | boolean | null>
>;

/** `THEME_CLUSTER`'s band variables, as sent (`docs/12` §8). */
export interface ThemeBandKeyInput {
  readonly minThemes: number;
  readonly maxThemes: number;
  readonly minPapersPerTheme: number;
}

/** Everything `tc` keys: one clustering stage's whole input. */
export interface ThemeClusteringKeyInput {
  /** Item key + hash of its digest block as sent; at least one. */
  readonly members: readonly SynthesisInputHash[];
  readonly themeBand: ThemeBandKeyInput;
  /**
   * The registry's `cacheEpochs` (`PROMPT_CACHE_EPOCHS`); the builder keys
   * {@link THEME_CLUSTERING_KEY_PROMPTS} only.
   */
  readonly promptCacheEpochs: Readonly<Record<string, number>>;
  readonly providerId: ProviderId;
  readonly call: SynthesisCallSettings;
  readonly stageInputs: SynthesisStageInputs;
}

/** Everything `cr` keys: one theme's analysis. */
export interface ThemeAnalysisKeyInput {
  readonly themeId: string;
  /** `{{THEME_NAME}}`: a re-clustering that renames the theme re-runs it. */
  readonly themeName: string;
  /** `{{THEME_DEFINITION}}`. */
  readonly themeDefinition: string;
  /** Item key + hash of its `PaperSummary` as sent; at least one. */
  readonly members: readonly SynthesisInputHash[];
  /** As for `tc`; the builder keys {@link THEME_ANALYSIS_KEY_PROMPTS} only. */
  readonly promptCacheEpochs: Readonly<Record<string, number>>;
  readonly providerId: ProviderId;
  readonly call: SynthesisCallSettings;
  readonly stageInputs: SynthesisStageInputs;
}

/** The self-critique settings `rp` keys (`report.maxCritiqueRounds`, `report.critiqueModel`). */
export interface ReportCritiqueKeyInput {
  /** `0` disables the critique; then nothing else here is keyed. */
  readonly rounds: number;
  readonly call: SynthesisCallSettings;
}

/** Everything `rp` keys: one language's composed and critiqued report. */
export interface ReportKeyInput {
  /** Picks `TREND_REPORT_EN` or `TREND_REPORT_KO`. */
  readonly language: ReportLanguage;
  /** Theme id + hash of its `ThemeAnalysis` as sent; at least one. */
  readonly themeAnalyses: readonly SynthesisInputHash[];
  /** Item key + hash of its digest block, for the digests actually sent. */
  readonly digests: readonly SynthesisInputHash[];
  /**
   * Item key + hash of every summary the critique may be shown — the cited
   * set is not known before the draft exists. Keyed only when the critique
   * runs.
   */
  readonly summaries: readonly SynthesisInputHash[];
  /** `{{TARGET_WORDS}}` as sent. */
  readonly targetWords: number;
  readonly critique: ReportCritiqueKeyInput;
  /** As for `tc`; the builder keys the language's report prompt, and `SELF_CRITIQUE` when the critique runs. */
  readonly promptCacheEpochs: Readonly<Record<string, number>>;
  readonly providerId: ProviderId;
  /** The report model's settings. */
  readonly call: SynthesisCallSettings;
  readonly stageInputs: SynthesisStageInputs;
}

/** A key and what it carries, so {@link synthesisTags} names exactly what was keyed. */
export interface SynthesisKey {
  readonly kind: SynthesisKeyKind;
  /** 64 hexadecimal characters. */
  readonly key: string;
  /** Every prompt whose `cacheEpoch` the key carries. */
  readonly promptIds: readonly string[];
  /** Every model the key carries, without repeats. */
  readonly modelIds: readonly string[];
  readonly providerId: ProviderId;
}

function synthesisError(builder: string, problem: string): RangeError {
  return new RangeError(`[research-helper] ${builder}: ${problem}`);
}

function requireNonEmpty(builder: string, name: string, value: string): void {
  if (value === "") throw synthesisError(builder, `${name} is empty`);
}

function requireFinite(builder: string, name: string, value: number): void {
  if (!Number.isFinite(value)) {
    throw synthesisError(builder, `${name} is not finite`);
  }
}

/**
 * The `cacheEpoch` of each of `promptIds`, picked from the registry's whole
 * map so that a bump to any other prompt cannot move the key.
 */
function stageEpochs(
  builder: string,
  promptIds: readonly string[],
  epochs: Readonly<Record<string, number>>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of promptIds) {
    const epoch = epochs[id];
    if (epoch === undefined || !Number.isInteger(epoch) || epoch < 1) {
      throw synthesisError(builder, `no cacheEpoch for ${id}`);
    }
    out[id] = epoch;
  }
  return out;
}

/**
 * `list` as `[id, hash]` pairs sorted by id, so the key is order-free.
 *
 * @throws RangeError for fewer than `minimum` entries, an empty id or hash,
 *   or an id listed twice
 */
function sortedInputs(
  builder: string,
  name: string,
  list: readonly SynthesisInputHash[],
  minimum: number,
): (readonly [string, string])[] {
  if (list.length < minimum) throw synthesisError(builder, `${name} is empty`);
  const seen = new Set<string>();
  for (const { id, hash } of list) {
    if (id === "" || hash === "") {
      throw synthesisError(builder, `${name} has an empty id or hash`);
    }
    if (seen.has(id))
      throw synthesisError(builder, `${name} lists ${id} twice`);
    seen.add(id);
  }
  return list
    .map(({ id, hash }) => [id, hash] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

/**
 * The call settings as a key component: only the three named fields, copied,
 * so a property a caller's object happens to carry never enters the key.
 */
function callComponent(
  builder: string,
  name: string,
  call: SynthesisCallSettings,
): { modelId: string; temperature: number; effort: string | null } {
  requireNonEmpty(builder, `${name}.modelId`, call.modelId);
  requireFinite(builder, `${name}.temperature`, call.temperature);
  return {
    modelId: call.modelId,
    temperature: call.temperature,
    effort: call.effort ?? null,
  };
}

/**
 * The clustering key, `tc`: the digests the stage is shown (by item key and
 * hash), the theme band, `THEME_CLUSTER`'s and `THEME_MERGE`'s `cacheEpoch`,
 * the provider, the call settings and the other prompt variables.
 *
 * @throws RangeError for a hole in an identifying component (see
 *   `docs/07` §9.1's 2026-10-27 block)
 */
export function themeClusteringKey(
  input: ThemeClusteringKeyInput,
): SynthesisKey {
  const builder = "themeClusteringKey";
  requireNonEmpty(builder, "providerId", input.providerId);
  const members = sortedInputs(builder, "members", input.members, 1);
  const epochs = stageEpochs(
    builder,
    THEME_CLUSTERING_KEY_PROMPTS,
    input.promptCacheEpochs,
  );
  const { minThemes, maxThemes, minPapersPerTheme } = input.themeBand;
  requireFinite(builder, "themeBand.minThemes", minThemes);
  requireFinite(builder, "themeBand.maxThemes", maxThemes);
  requireFinite(builder, "themeBand.minPapersPerTheme", minPapersPerTheme);
  const call = callComponent(builder, "call", input.call);
  return {
    kind: "tc",
    key: cacheKey(
      "tc",
      members,
      { minThemes, maxThemes, minPapersPerTheme },
      epochs,
      input.providerId,
      call,
      input.stageInputs,
    ),
    promptIds: [...THEME_CLUSTERING_KEY_PROMPTS],
    modelIds: [call.modelId],
    providerId: input.providerId,
  };
}

/**
 * One theme's analysis key, `cr`: the theme's id, name and definition, its
 * members' summaries (by item key and hash), `CLUSTER_REDUCE`'s and
 * `CLUSTER_REDUCE_MERGE`'s `cacheEpoch`, the provider, the call settings and
 * the other prompt variables. Another theme's members are not a component,
 * so a change there leaves this key alone.
 *
 * @throws RangeError for a hole in an identifying component
 */
export function themeAnalysisKey(input: ThemeAnalysisKeyInput): SynthesisKey {
  const builder = "themeAnalysisKey";
  requireNonEmpty(builder, "providerId", input.providerId);
  requireNonEmpty(builder, "themeId", input.themeId);
  const members = sortedInputs(builder, "members", input.members, 1);
  const epochs = stageEpochs(
    builder,
    THEME_ANALYSIS_KEY_PROMPTS,
    input.promptCacheEpochs,
  );
  const call = callComponent(builder, "call", input.call);
  return {
    kind: "cr",
    key: cacheKey(
      "cr",
      input.themeId,
      input.themeName,
      input.themeDefinition,
      members,
      epochs,
      input.providerId,
      call,
      input.stageInputs,
    ),
    promptIds: [...THEME_ANALYSIS_KEY_PROMPTS],
    modelIds: [call.modelId],
    providerId: input.providerId,
  };
}

/**
 * The report key, `rp`: the language, the theme analyses and digests sent,
 * the target length, the report prompt's `cacheEpoch`, the provider, the
 * report call's settings, the other prompt variables and the critique — its
 * rounds, and when it runs, `SELF_CRITIQUE`'s `cacheEpoch`, its call's
 * settings and the summaries it may be shown.
 *
 * @throws RangeError for a hole in an identifying component, or a critique
 *   round count that is not a non-negative integer
 */
export function reportKey(input: ReportKeyInput): SynthesisKey {
  const builder = "reportKey";
  requireNonEmpty(builder, "providerId", input.providerId);
  const reportPrompt = REPORT_PROMPT_BY_LANGUAGE[input.language] as
    string | undefined;
  if (reportPrompt === undefined) {
    throw synthesisError(builder, "language is not en or ko");
  }
  const { rounds } = input.critique;
  if (!Number.isInteger(rounds) || rounds < 0) {
    throw synthesisError(builder, "critique.rounds is not a whole number");
  }
  const critiques = rounds > 0;
  const promptIds = critiques
    ? [reportPrompt, SELF_CRITIQUE_PROMPT]
    : [reportPrompt];
  const epochs = stageEpochs(builder, promptIds, input.promptCacheEpochs);
  const themeAnalyses = sortedInputs(
    builder,
    "themeAnalyses",
    input.themeAnalyses,
    1,
  );
  const digests = sortedInputs(builder, "digests", input.digests, 0);
  requireFinite(builder, "targetWords", input.targetWords);
  const call = callComponent(builder, "call", input.call);
  const critiqueCall = critiques
    ? callComponent(builder, "critique.call", input.critique.call)
    : undefined;
  const critique =
    critiqueCall === undefined
      ? { rounds }
      : {
          rounds,
          call: critiqueCall,
          summaries: sortedInputs(builder, "summaries", input.summaries, 0),
        };
  const modelIds = [call.modelId];
  if (critiqueCall !== undefined && critiqueCall.modelId !== call.modelId) {
    modelIds.push(critiqueCall.modelId);
  }
  return {
    kind: "rp",
    key: cacheKey(
      "rp",
      input.language,
      themeAnalyses,
      digests,
      input.targetWords,
      epochs,
      input.providerId,
      call,
      critique,
      input.stageInputs,
    ),
    promptIds,
    modelIds,
    providerId: input.providerId,
  };
}

/**
 * `promptVersion:<promptId>@<line>`, each part escaped by
 * {@link encodeTagValue}: the string `promptVersionTag`
 * (`src/pipeline/summarize/summaryCache.ts`) writes for a version on that
 * line, so `reconcilePromptVersions`'s startup invalidation reaches synthesis
 * entries too (`docs/06` §11.2, reading 8 and reading 4 of 2026-10-27).
 *
 * @param line - `promptCacheLine(version)`, `MAJOR.MINOR`
 */
export function promptLineTag(promptId: string, line: string): string {
  return `${PROMPT_LINE_TAG_PREFIX}${encodeTagValue(promptId)}@${encodeTagValue(line)}`;
}

/**
 * The tags a synthesis entry is written with: one {@link promptLineTag} per
 * prompt the key carries, `model:<id>` per model it carries and
 * `provider:<id>`. `work:` tags, which keep a running job's entries from
 * eviction, are the caller's to add.
 *
 * @param promptLines - each prompt id's `promptCacheLine(version)`; taken
 *   from the caller because `core/` may not import `prompts/`
 * @throws RangeError when `promptLines` has no line for a prompt the key
 *   carries
 */
export function synthesisTags(
  key: SynthesisKey,
  promptLines: Readonly<Record<string, string>>,
): readonly string[] {
  const tags = key.promptIds.map((id) => {
    const line = promptLines[id];
    if (line === undefined || line === "") {
      throw synthesisError("synthesisTags", `no prompt line for ${id}`);
    }
    return promptLineTag(id, line);
  });
  for (const modelId of key.modelIds) {
    tags.push(`model:${encodeTagValue(modelId)}`);
  }
  tags.push(`provider:${encodeTagValue(key.providerId)}`);
  return tags;
}

// ---------------------------------------------------------------------------
// SHA-256 (FIPS 180-4)
// ---------------------------------------------------------------------------

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

/**
 * Lower-case hex SHA-256 of `text`'s UTF-8 bytes.
 *
 * @param text - any string
 * @returns 64 hexadecimal characters
 */
export function sha256Hex(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const bitLength = bytes.length * 8;
  // Message, the 0x80 marker, zero padding, and the 64-bit length.
  const blocks = Math.ceil((bytes.length + 9) / 64);
  const padded = new Uint8Array(blocks * 64);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(padded.length - 4, bitLength >>> 0);

  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let t = 0; t < 16; t += 1) w[t] = view.getUint32(offset + t * 4);
    for (let t = 16; t < 64; t += 1) {
      const w15 = w[t - 15] ?? 0;
      const w2 = w[t - 2] ?? 0;
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
      w[t] = ((w[t - 16] ?? 0) + s0 + (w[t - 7] ?? 0) + s1) >>> 0;
    }
    let a = h[0] ?? 0;
    let b = h[1] ?? 0;
    let c = h[2] ?? 0;
    let d = h[3] ?? 0;
    let e = h[4] ?? 0;
    let f = h[5] ?? 0;
    let g = h[6] ?? 0;
    let hh = h[7] ?? 0;
    for (let t = 0; t < 64; t += 1) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + s1 + ch + (K[t] ?? 0) + (w[t] ?? 0)) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] = ((h[0] ?? 0) + a) >>> 0;
    h[1] = ((h[1] ?? 0) + b) >>> 0;
    h[2] = ((h[2] ?? 0) + c) >>> 0;
    h[3] = ((h[3] ?? 0) + d) >>> 0;
    h[4] = ((h[4] ?? 0) + e) >>> 0;
    h[5] = ((h[5] ?? 0) + f) >>> 0;
    h[6] = ((h[6] ?? 0) + g) >>> 0;
    h[7] = ((h[7] ?? 0) + hh) >>> 0;
  }
  return Array.from(h, (word) => word.toString(16).padStart(8, "0")).join("");
}
