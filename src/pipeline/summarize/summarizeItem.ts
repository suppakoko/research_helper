/**
 * One item in, one validated `PaperSummary` out — grounded against its own
 * source text and recorded as a redaction-gated `StoredSummary` row
 * (`P3-T25`; `docs/06` §5.4, §6.4, §7, §11, §12.1, §13.5; `docs/07` §5.2).
 *
 * ## Callers (`plan/README.md` §5 rule 10)
 *
 * - The summarize pipeline, `summarizePipeline.ts` (`P3-T29`): one
 *   {@link summarizeItem} call per item under the `llm` pool, with the deps
 *   {@link summarizeItemDepsFrom} builds once per job from its
 *   `PipelineContext`. `P3-T29` also constructs the {@link SummaryStore}
 *   (`createSummaryStore`, `src/zotero/db.ts`) on the one shared connection
 *   in `installPluginDatabase` (`src/bootstrap/pluginDatabase.ts`).
 * - The item pane's Generate button (`summarySection.ts`, `P3-T28`).
 *
 * Nothing calls this module before those cards.
 *
 * ## What one call does
 *
 * 1. **Tier 4 never reaches a model** (`docs/06` §3.5): a `metadata_only`
 *    source, or one DR-1 sends to an abstract it does not have, gets
 *    `buildMetadataOnlySummary`'s stub and **no row** (`docs/07` §5.2's note
 *    of 2026-10-28, item 1).
 * 2. **DR-1** ({@link decideDr1}, `docs/06` §5.4 and its note of 2026-10-28)
 *    over the acquisition, `summary.fullTextMode` limited by the privacy
 *    mode, and the run's cost decision.
 * 3. **The model**: `resolveModel("standard")`, refused when it is a floating
 *    alias ({@link isFloatingModelAlias}) or when the privacy mode refuses it.
 * 4. **The path**: the abstract (`PAPER_SUMMARY_ABSTRACT`), the single-shot
 *    full text (`PAPER_SUMMARY_FULLTEXT`) or the chunked full text
 *    (`CHUNK_MAP` then `CHUNK_REDUCE`), planned by `planChunks` and sent
 *    through `runWithContextRetry` (`src/llm/shared/chunking.ts`). The
 *    chunker runs **flat** until `P3-T22` and gate `G-22` rule (`plan/00` §6
 *    item 300): {@link SummarizeItemDeps.imradDetectorValidated}.
 * 5. **The cache first** (`P3-T26`): every plan's key is looked up before any
 *    call; a hit makes none. Under the item pane's Regenerate
 *    ({@link SummarizeItemInput.bypassCache}, item 305(c)) nothing is looked
 *    up and the call is made.
 * 6. Every request goes through `completeJSON` at the prompt's temperature
 *    (0), `top_p: 1`, a fixed seed, `effort: "low"` on the summary prompts,
 *    the mode's routing hints and `budget: deps.budget`.
 * 7. **The checks**: `itemKey` and `sourceTier` overwritten with one warning
 *    each on a mismatch; `checkGrounding` with the one retry and the `low`
 *    marking; §18.4's numerals (`./grounding.ts`; `docs/06` §12.1's note).
 * 8. **The row**: `StoredSummary` through the redaction gate
 *    (`gateStoredSummary`, `src/zotero/db.ts`), written by the store.
 *
 * The system message is the template's, never interpolated, so it is
 * byte-identical across every item of a run (`docs/06` §11.4). Paper content
 * goes in the user message only.
 *
 * **Layering.** `pipeline/` may import `llm/`, `prompts/`, `zotero/` and
 * `core/` (`docs/07` §2.3). The prompt registry arrives as a dependency:
 * `src/prompts/bundled.ts` imports `.md` files, which Vitest cannot load.
 */

import { sha256Hex } from "../../core/cache/keys";
import type { Clock } from "../../core/clock";
import { ConfigurationError, PolicyViolationError } from "../../core/errors";
import type { CancellationToken } from "../../core/jobQueue/cancellation";
import type { Logger } from "../../core/logger";
import {
  planChunks,
  runWithContextRetry,
  UNKNOWN_SECTION,
  type ChunkedPlan,
  type ChunkModel,
  type ChunkPlan,
  type ChunkPromptOverhead,
  type TextChunk,
} from "../../llm/shared/chunking";
import {
  completeJSON,
  type StructuredRequest,
} from "../../llm/shared/jsonMode";
import { estTokens } from "../../llm/shared/tokenEstimate";
import type {
  BudgetGuard,
  Effort,
  LLMRouter,
  ModelInfo,
  Usage,
} from "../../llm/types";
import type { ProviderId } from "../../model/ids";
import type {
  AcquiredSource,
  PaperSummary,
  SourceTier,
  StoredSummary,
  StoredSummaryPromptId,
  SummaryInputScope,
} from "../../model/summary";
import {
  renderPrompt,
  resolveMaxTokens,
  type JsonSchemaObject,
  type PromptRegistry,
  type PromptTemplate,
} from "../../prompts";
import {
  gateStoredSummary,
  type SummaryStore,
  type UngatedStoredSummary,
} from "../../zotero/db";
import type { ConfigReader, PipelineContext } from "../types";
import {
  modelRouteFor,
  routingHints,
  type FullTextMode,
  type InputScopeKind,
  type PrivacyPolicy,
} from "../shared/privacyPolicy";

import { buildMetadataOnlySummary, type MetadataOnlySummary } from "./acquire";
import {
  checkGrounding,
  checkNumeralInvariants,
  GROUNDING_LOW_SCORE,
} from "./grounding";
import { applyNonEnglishPolicy, type ScreenDecision } from "./screen";
import {
  createSummaryCache,
  type CachedSummary,
  type SummaryCache,
  type SummaryCacheLookup,
  type SummaryCacheRequest,
  type SummaryPromptId,
} from "./summaryCache";

// ===========================================================================
// 1. Constants
// ===========================================================================

/** DR-1 condition 3: full text is worth sending at three times the abstract. */
export const DR1_FULL_TEXT_MIN_RATIO = 3;

/**
 * The `seed` every summary request carries (`docs/06` §11.1: "where the
 * provider supports it"); the adapters drop it where it has no meaning.
 * `docs/06` fixes no value; any fixed one serves.
 */
export const SUMMARY_SEED = 0;

/** `docs/06` §11.1: `top_p: 1`. */
export const SUMMARY_TOP_P = 1;

/**
 * `plan/04` `P3-T25` note of 2026-10-21 (`plan/00` §6 item 262(a)): every
 * summary request sends `low`. `CHUNK_MAP` is `docs/12` §18.5's `cheap` row,
 * "not assigned", and sends none (`docs/06` §5.3's note of 2026-10-28).
 */
export const SUMMARY_EFFORT: Effort = "low";

/**
 * `docs/06` §12.1 L3: "retry once at temperature 0 with an added
 * instruction". Drafted by `P3-T25` for the owner to confirm (`docs/06`
 * §12.1's note of 2026-10-28, item (4)); appended to the user message.
 */
export const GROUNDING_RETRY_INSTRUCTION =
  'Some "verbatimSupport" quotations in a previous answer to this request ' +
  'were not found in the paper\'s text. Every "verbatimSupport" must be ' +
  "copied character for character from the text above (from chunk " +
  "extractions, a chunk quotation carried through unchanged). If no single " +
  'quotation supports a finding, set "verbatimSupport" to null.';

/** The row warning for a summary still below the grounding line. */
export const GROUNDING_LOW_WARNING = "grounding_low_findings_excluded";
/** The row warning for a model `itemKey` that was not the item's. */
export const ITEM_KEY_MISMATCH_WARNING = "item_key_mismatch";
/** The row warning for a model `sourceTier` that was not the text's. */
export const SOURCE_TIER_MISMATCH_WARNING = "source_tier_mismatch";

/** `docs/12` §5's first `{{COMPLETENESS_NOTE}}`. */
export const COMPLETE_NOTE =
  "Complete article text; references and supplementary material removed.";

/** `<omittedSections>` on the flat path (`docs/12` §5's note of 2026-10-28). */
export const FLAT_OMITTED_SECTIONS = "the end of the text";

/** A missing metadata value, as sent (`docs/12` §5's note of 2026-10-28). */
export const UNKNOWN_METADATA = "unknown";

/** `docs/12` §4's `{{TAGS}}` with no tag. */
export const NO_TAGS = "none";

/** The `json_schema` name of a payload request: the schema's `title`. */
const PAPER_SUMMARY_SCHEMA_NAME = "PaperSummary";
/** The `json_schema` name of a map request. */
const CHUNK_MAP_SCHEMA_NAME = "ChunkMapAnswer";

const STRING = { type: "string" } as const;
const NULLABLE_STRING = { type: ["string", "null"] } as const;

/** One `{ "text", "quote" }` signal. */
const TEXT_SIGNAL = {
  type: "object",
  required: ["text", "quote"],
  properties: { text: STRING, quote: STRING },
} as const;

/**
 * `docs/12` §6's "Return JSON" block as a schema (`docs/12` §5's note of
 * 2026-10-28, item (4)): `chunk-map.v1.0.0.md` says `schema: none` and a
 * released file is not edited (§17.5). Extra members are allowed.
 */
export const CHUNK_MAP_ANSWER_SCHEMA: JsonSchemaObject = Object.freeze({
  title: CHUNK_MAP_SCHEMA_NAME,
  type: "object",
  required: [
    "designSignals",
    "populationSignals",
    "methodSignals",
    "findingSignals",
    "numberSignals",
    "limitationSignals",
    "noveltySignals",
  ],
  properties: {
    chunkIndex: { type: ["integer", "string"] },
    section: STRING,
    designSignals: { type: "array", items: TEXT_SIGNAL },
    populationSignals: { type: "array", items: TEXT_SIGNAL },
    methodSignals: { type: "array", items: TEXT_SIGNAL },
    findingSignals: {
      type: "array",
      items: {
        type: "object",
        required: ["statement", "direction", "quote"],
        properties: {
          statement: STRING,
          direction: {
            type: "string",
            enum: [
              "positive",
              "negative",
              "null_result",
              "mixed",
              "descriptive",
            ],
          },
          quote: STRING,
        },
      },
    },
    numberSignals: {
      type: "array",
      items: {
        type: "object",
        required: ["metric", "value", "quote"],
        properties: {
          metric: STRING,
          value: STRING,
          comparison: NULLABLE_STRING,
          pValue: NULLABLE_STRING,
          quote: STRING,
        },
      },
    },
    limitationSignals: { type: "array", items: TEXT_SIGNAL },
    noveltySignals: { type: "array", items: TEXT_SIGNAL },
  },
});

// ===========================================================================
// 2. Types
// ===========================================================================

/** The item's metadata, as the prompts show it. Every member is untrusted text. */
export interface SummaryItemMetadata {
  readonly title: string;
  /** Creator names as the caller formats them; joined by `; `. */
  readonly authors: readonly string[];
  readonly year?: string | number | undefined;
  readonly venue?: string | undefined;
  /** Zotero's item type, e.g. `journalArticle`. */
  readonly itemType?: string | undefined;
  readonly doi?: string | undefined;
  readonly tags: readonly string[];
}

/** D-06-3's page counts, which `AcquiredSource` does not carry. */
export interface SourcePageCounts {
  readonly indexedPages: number;
  readonly totalPages: number;
}

/** One item to summarize. */
export interface SummarizeItemInput {
  /** What acquisition produced (`docs/06` §3.6). */
  readonly source: AcquiredSource;
  /** `docs/07` §5.1's work key: the row's identity and the cache's `work:` tag. */
  readonly workKey: string;
  readonly metadata: SummaryItemMetadata;
  /** The run's `summary.fullTextMode`, before the privacy mode limits it. */
  readonly fullTextMode: FullTextMode;
  /**
   * DR-1 condition 4: true when the run's confirmation kept full text out
   * ("use abstracts instead", or a ceiling the user did not lift). Read in
   * `auto` only (`docs/06` §5.4's note of 2026-10-28).
   */
  readonly costGateBlocksFullText: boolean;
  /** Required when `source.truncated` is true and full text is sent. */
  readonly pageCounts?: SourcePageCounts | undefined;
  /** Zotero's `dateModified` for the item (`StoredSummary.sourceItemVersion`). */
  readonly sourceItemVersion?: string | undefined;
  /** `P3-T27`'s decision for a non-English item, applied to the stored row. */
  readonly nonEnglish?:
    Pick<ScreenDecision, "nonEnglishPolicy" | "sourceLanguage"> | undefined;
  /**
   * The item pane's Regenerate (owner, `plan/00` §6 item 305(c)): no
   * {@link SummaryCache.lookup} on any path, so the call is made; its answer
   * is stored under the same key and row id, replacing both. Set by the
   * summarize pipeline only when `bypassesStoredResult` holds.
   */
  readonly bypassCache?: boolean | undefined;
}

/** What {@link summarizeItem} needs: the job's context, in pieces. */
export interface SummarizeItemDeps {
  /** `PipelineContext.llm`: the budgeted router. */
  readonly llm: Pick<LLMRouter, "activeProvider" | "resolveModel" | "chat">;
  /** `PipelineContext.budget`, passed on **every** call. */
  readonly budget: BudgetGuard;
  readonly token: CancellationToken;
  /** `PipelineContext.privacy`. */
  readonly privacy: PrivacyPolicy;
  /** `PipelineContext.config`: `logRequestBodies`, `gemini.paidTier`. */
  readonly config: Pick<ConfigReader, "get">;
  /** The prompt registry (`PROMPT_REGISTRY` in the product). */
  readonly prompts: Pick<PromptRegistry, "get">;
  /** One per job, over `PipelineContext.cache` (`createSummaryCache`). */
  readonly summaryCache: SummaryCache;
  readonly store: Pick<SummaryStore, "put" | "get">;
  readonly clock: Pick<Clock, "now">;
  /**
   * The adapter's `ModelInfo` for the resolved model: its context window for
   * the chunker and its data policy for the privacy check. Absent means a
   * window not known and a policy judged `unknown`.
   */
  readonly modelInfo?: (
    providerId: ProviderId,
    modelId: string,
  ) => ModelInfo | undefined;
  /**
   * The run's confirmation already covered a model the mode lets through
   * only after one (`full` mode, a model that may train on input).
   */
  readonly modelConfirmed?: boolean;
  /**
   * `P3-T22`'s `IMRAD_DETECTOR_VALIDATED`. Until it is wired, `false`: the
   * chunker runs flat (`plan/00` §6 item 300).
   */
  readonly imradDetectorValidated?: boolean;
  /** The token counter; `estTokens(text, modelId)` by default. */
  readonly countTokens?: (text: string, modelId: string) => number;
  readonly logger?: Logger;
  /** Prefix of each request's `traceId`. */
  readonly traceId?: string;
}

/** What {@link summarizeItem} produced. */
export type SummarizeItemResult =
  | {
      /** Tier 4: §3.5's stub, no call and no row. */
      readonly kind: "stub";
      readonly summary: MetadataOnlySummary;
    }
  | {
      readonly kind: "summarized";
      /** The row as written (or as already stored, on a hit). */
      readonly stored: StoredSummary;
      /** `true`: no model call was made for this summary. */
      readonly fromCache: boolean;
      /** Requests sent, repairs and retries included. */
      readonly calls: number;
    };

/** DR-1's answer. */
export type Dr1Choice = "fulltext" | "abstract" | "metadata";

/** What {@link decideDr1} reads. */
export interface Dr1Input {
  readonly tier: SourceTier;
  readonly abstract: string | null;
  readonly text: string;
  /** After the privacy mode (`allowedInputScope`). */
  readonly fullTextMode: FullTextMode;
  readonly costGateBlocksFullText: boolean;
  readonly countTokens: (text: string) => number;
}

/** One `CHUNK_MAP` answer as the reduce sees it. */
interface MapAnswer {
  readonly start: number;
  readonly answer: Record<string, unknown>;
}

/** Everything one plan sends, and the cache request it is keyed by. */
interface Prepared {
  readonly promptId: SummaryPromptId;
  readonly sentText: string;
  readonly contentHash: string;
  readonly tier: SourceTier;
  readonly inputScope: SummaryInputScope;
  readonly truncated: boolean;
  readonly request: SummaryCacheRequest;
  /** The payload request (abstract, single-shot), built on demand. */
  readonly vars: Readonly<Record<string, string>>;
  readonly plan: ChunkPlan | undefined;
}

// ===========================================================================
// 3. DR-1 and the model checks
// ===========================================================================

function hasText(value: string | null | undefined): value is string {
  return value !== null && value !== undefined && value.trim() !== "";
}

/**
 * `docs/06` §5.4's DR-1 as a pure function (its note of 2026-10-28).
 *
 * @param input - the acquisition, the mode-limited mode, the cost decision
 * @returns `fulltext`, `abstract`, or `metadata` (the stub, no call)
 */
export function decideDr1(input: Dr1Input): Dr1Choice {
  if (input.tier === "metadata_only") return "metadata";
  const fullTextTier =
    (input.tier === "fulltext_pdf" || input.tier === "fulltext_epmc") &&
    hasText(input.text);
  const mode = input.fullTextMode;
  if (fullTextTier && (mode === "auto" || mode === "always")) {
    const abstractTokens = hasText(input.abstract)
      ? input.countTokens(input.abstract)
      : 0;
    const addsMaterial =
      mode === "always" ||
      input.countTokens(input.text) >= DR1_FULL_TEXT_MIN_RATIO * abstractTokens;
    const costAllows = mode !== "auto" || !input.costGateBlocksFullText;
    if (addsMaterial && costAllows) return "fulltext";
  }
  return hasText(input.abstract) ? "abstract" : "metadata";
}

/**
 * A model identifier that names no fixed model (`docs/06` §11.1: "never a
 * floating alias like `-latest`"; `docs/03` §5.5's `~openai/gpt-latest`).
 *
 * @param modelId - the resolved identifier
 */
export function isFloatingModelAlias(modelId: string): boolean {
  return /^~/u.test(modelId) || /latest$/iu.test(modelId.trim());
}

function unknownPolicyModel(modelId: string): ModelInfo {
  return {
    id: modelId,
    displayName: modelId,
    contextWindowTokens: 0,
    maxOutputTokens: 0,
    supportsJsonSchema: false,
    supportsStreaming: false,
    supportsSystemPrompt: true,
    inputCostPerMTokUsd: undefined,
    outputCostPerMTokUsd: undefined,
    dataPolicy: {
      trainsOnInputByDefault: "unknown",
      retention: { days: "unknown", note: "" },
    },
  };
}

// ===========================================================================
// 4. Variables
// ===========================================================================

function orUnknown(value: string | number | undefined): string {
  if (value === undefined) return UNKNOWN_METADATA;
  const text = String(value).trim();
  return text === "" ? UNKNOWN_METADATA : text;
}

/**
 * `docs/12` §4's metadata variables (§5's note of 2026-10-28, item (2)).
 *
 * @param metadata - the item's metadata
 * @param itemKey - the true item key
 */
export function metadataVariables(
  metadata: SummaryItemMetadata,
  itemKey: string,
): Record<string, string> {
  const authors = metadata.authors
    .map((name) => name.trim())
    .filter((name) => name !== "");
  const tags = metadata.tags.map((tag) => tag.trim()).filter((t) => t !== "");
  return {
    ITEM_KEY: itemKey,
    TITLE: orUnknown(metadata.title),
    AUTHORS: authors.length > 0 ? authors.join("; ") : UNKNOWN_METADATA,
    YEAR: orUnknown(metadata.year),
    VENUE: orUnknown(metadata.venue),
    ITEM_TYPE: orUnknown(metadata.itemType),
    DOI: orUnknown(metadata.doi),
    TAGS: tags.length > 0 ? tags.join(", ") : NO_TAGS,
  };
}

/**
 * `docs/12` §5's `{{COMPLETENESS_NOTE}}` (its note of 2026-10-28, item (1)).
 *
 * @param source - the acquisition
 * @param plan - the plan the text is sent by
 * @param pageCounts - D-06-3's page counts
 * @throws ConfigurationError for a truncated source without its page counts
 */
export function completenessNote(
  source: Pick<AcquiredSource, "truncated">,
  plan: ChunkPlan | undefined,
  pageCounts: SourcePageCounts | undefined,
): string {
  if (source.truncated) {
    if (pageCounts === undefined) {
      throw new ConfigurationError(
        "a page-capped full text needs its page counts for COMPLETENESS_NOTE " +
          "(docs/12 §5); nothing was sent",
      );
    }
    return (
      `PARTIAL: only the first ${String(pageCounts.indexedPages)} of ` +
      `${String(pageCounts.totalPages)} pages were indexed. Later sections ` +
      "may be missing."
    );
  }
  if (plan?.kind === "chunked" && plan.truncated) {
    const omitted =
      plan.path === "section-aware" && plan.cutSections.length > 0
        ? plan.cutSections.join(", ")
        : FLAT_OMITTED_SECTIONS;
    return (
      "Section-filtered: the following sections were omitted to fit the " +
      `context budget: ${omitted}.`
    );
  }
  return COMPLETE_NOTE;
}

/** The chunks in document order. */
function byStart(chunks: readonly TextChunk[]): TextChunk[] {
  return [...chunks].sort((a, b) => a.start - b.start);
}

/**
 * The text a chunked plan sends: each chunk's new content, in document
 * order (`docs/06` §11.2's note of 2026-10-28).
 */
export function chunkedSentText(text: string, plan: ChunkedPlan): string {
  return byStart(plan.chunks)
    .map((chunk) => text.slice(chunk.contentStart, chunk.end))
    .join("");
}

/** `{{CHUNK_TEXT}}`: the label line, then the chunk (`docs/06` §5.3's note). */
export function chunkText(chunk: TextChunk): string {
  return `${chunk.label}\n${chunk.text}`;
}

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

// ===========================================================================
// 5. The summarizer
// ===========================================================================

/**
 * Summarize one item (module note).
 *
 * @param input - the acquisition and the run's choices
 * @param deps - the job's context
 * @returns the stub, or the stored row
 * @throws BudgetExceededError, OperationCancelledError and the `LLMError`s
 *   `completeJSON` throws, unchanged; PolicyViolationError when the privacy
 *   mode refuses the model; ConfigurationError for a floating model alias or
 *   a page-capped text without its page counts. A `CHUNK_REDUCE`
 *   context-length error is never retried (`docs/06` §5.3's note of
 *   2026-10-28, item (5)).
 */
export async function summarizeItem(
  input: SummarizeItemInput,
  deps: SummarizeItemDeps,
): Promise<SummarizeItemResult> {
  const { source } = input;
  deps.token.throwIfCancelled();
  // Regenerate's bypass (item 305(c)): a lookup that always misses.
  const lookup = (
    request: SummaryCacheRequest,
  ): Promise<SummaryCacheLookup<PaperSummary>> =>
    input.bypassCache === true
      ? Promise.resolve({
          hit: false,
          key: deps.summaryCache.keyOf(request),
          reason: "miss",
        })
      : deps.summaryCache.lookup<PaperSummary>(request);

  const stub = (): SummarizeItemResult => ({
    kind: "stub",
    summary: buildMetadataOnlySummary(
      { ...source, tier: "metadata_only", text: "", sections: [] },
      input.metadata.tags,
    ),
  });
  if (source.tier === "metadata_only") return stub();

  const mode = deps.privacy.mode;
  const allowed = deps.privacy.allowedInputScope(mode, {
    fullTextMode: input.fullTextMode,
  });

  // The model, before any request: resolvable, pinned, and allowed.
  const model = deps.llm.resolveModel("standard");
  if (isFloatingModelAlias(model.modelId)) {
    throw new ConfigurationError(
      "a summary needs a pinned model identifier, not a floating alias " +
        "(docs/06 §11.1); nothing was sent",
      { modelId: model.modelId },
    );
  }
  const count = (text: string): number =>
    (deps.countTokens ?? estTokens)(text, model.modelId);

  const choice = decideDr1({
    tier: source.tier,
    abstract: source.abstract,
    text: source.text,
    fullTextMode: allowed.fullTextMode,
    costGateBlocksFullText: input.costGateBlocksFullText,
    countTokens: count,
  });
  if (choice === "metadata") return stub();

  const info = deps.modelInfo?.(model.providerId, model.modelId);
  const check = deps.privacy.assertModelAllowed(
    info ?? unknownPolicyModel(model.modelId),
    mode,
    modelRouteFor(model.providerId, () => deps.config.get("geminiPaidTier")),
  );
  if (check.requiresConfirmation && deps.modelConfirmed !== true) {
    throw new PolicyViolationError(
      `model "${model.modelId}" needs the user's confirmation in ${mode} ` +
        "privacy mode, and the run did not give it (docs/09 §3.5)",
      { mode, modelId: model.modelId },
    );
  }

  const routing = routingHints(mode);
  const includeBodies = deps.config.get("logRequestBodies");
  const usages: Usage[] = [];
  let calls = 0;
  const trace = (step: string): string =>
    `${deps.traceId ?? "summary"}:${source.itemKey}:${step}`;

  const structured = (
    template: PromptTemplate,
    vars: Readonly<Record<string, string>>,
    options: {
      readonly schema: JsonSchemaObject;
      readonly schemaName: string;
      readonly effort?: Effort | undefined;
      readonly extraUser?: string | undefined;
      readonly step: string;
    },
  ): StructuredRequest => {
    const rendered = renderPrompt(template, vars);
    const user =
      options.extraUser === undefined
        ? rendered.user
        : `${rendered.user}\n\n${options.extraUser}`;
    return {
      model: model.modelId,
      messages: [
        { role: "system", content: rendered.system },
        { role: "user", content: user },
      ],
      maxOutputTokens: resolveMaxTokens(template),
      temperature: template.defaultTemperature,
      topP: SUMMARY_TOP_P,
      seed: SUMMARY_SEED,
      ...(options.effort !== undefined && { effort: options.effort }),
      responseFormat: {
        kind: "json_schema",
        name: options.schemaName,
        schema: options.schema,
      },
      routing,
      traceId: trace(options.step),
    };
  };

  const send = async <T>(request: StructuredRequest): Promise<T> => {
    deps.token.throwIfCancelled();
    try {
      const done = await completeJSON<T>(
        deps.llm,
        request,
        { token: deps.token, budget: deps.budget },
        { includeBodies },
      );
      usages.push(done.usage);
      calls += done.calls;
      return done.value;
    } catch (error) {
      calls += 1;
      throw error;
    }
  };

  const schemaOf = (template: PromptTemplate): JsonSchemaObject => {
    if (template.schema === null) {
      throw new ConfigurationError(
        `${template.id} has no output schema; a summary cannot be validated`,
      );
    }
    return template.schema;
  };

  const base = metadataVariables(input.metadata, source.itemKey);

  const cacheRequest = (
    promptId: SummaryPromptId,
    contentHash: string,
    tier: SourceTier,
    inputScopeKind: InputScopeKind,
    promptMetadata: Readonly<Record<string, string>>,
    temperature: number,
  ): SummaryCacheRequest => ({
    libraryID: source.libraryID,
    itemKey: source.itemKey,
    workKey: input.workKey,
    contentHash,
    tier,
    inputScopeKind,
    promptId,
    promptMetadata,
    providerId: model.providerId,
    modelId: model.modelId,
    temperature,
  });

  const hashOf = (sent: string): string =>
    sent === source.text ? source.contentHash : sha256Hex(sent);

  // -------------------------------------------------------------------------
  // The payload's checks, before the cache stores it
  // -------------------------------------------------------------------------

  const rowWarnings: string[] = [];
  const overwriteIdentity = (
    value: PaperSummary,
    tier: SourceTier,
  ): PaperSummary => {
    if (value.itemKey !== source.itemKey) {
      deps.logger?.warn("summary: the model returned another itemKey", {
        itemKey: source.itemKey,
      });
      if (!rowWarnings.includes(ITEM_KEY_MISMATCH_WARNING)) {
        rowWarnings.push(ITEM_KEY_MISMATCH_WARNING);
      }
    }
    if (value.sourceTier !== tier) {
      if (!rowWarnings.includes(SOURCE_TIER_MISMATCH_WARNING)) {
        rowWarnings.push(SOURCE_TIER_MISMATCH_WARNING);
      }
    }
    return { ...value, itemKey: source.itemKey, sourceTier: tier };
  };

  const scoreOf = (value: PaperSummary, sent: string): number | null =>
    checkGrounding(value, sent).score;

  /**
   * §12.1's policy on a fresh answer: one retry for full text, then `low`.
   */
  const groundFresh = async (
    first: PaperSummary,
    prepared: Prepared,
    retry: () => Promise<PaperSummary>,
  ): Promise<PaperSummary> => {
    let kept = first;
    let score = scoreOf(kept, prepared.sentText);
    const fullText = prepared.tier !== "abstract";
    if (score !== null && score < GROUNDING_LOW_SCORE && fullText) {
      const second = overwriteIdentity(await retry(), prepared.tier);
      const secondScore = scoreOf(second, prepared.sentText);
      if (secondScore !== null && secondScore >= score) {
        kept = second;
        score = secondScore;
      }
    }
    if (score !== null && score < GROUNDING_LOW_SCORE) {
      kept = { ...kept, confidence: "low" };
    }
    return kept;
  };

  // -------------------------------------------------------------------------
  // The abstract path
  // -------------------------------------------------------------------------

  let prepared: Prepared;
  let entry: CachedSummary<PaperSummary>;
  let fromCache: boolean;
  const cacheWarnings: string[] = [];

  if (choice === "abstract") {
    const template = deps.prompts.get("PAPER_SUMMARY_ABSTRACT");
    const schema = schemaOf(template);
    const abstract = source.abstract as string;
    const meta = { ...base, JSON_SCHEMA: JSON.stringify(schema) };
    const vars = { ...meta, ABSTRACT: abstract };
    const contentHash = hashOf(abstract);
    prepared = {
      promptId: "PAPER_SUMMARY_ABSTRACT",
      sentText: abstract,
      contentHash,
      tier: "abstract",
      inputScope: { kind: "abstract" },
      truncated: false,
      request: cacheRequest(
        "PAPER_SUMMARY_ABSTRACT",
        contentHash,
        "abstract",
        "abstract",
        meta,
        template.defaultTemperature,
      ),
      vars,
      plan: undefined,
    };
    const found = await lookup(prepared.request);
    if (found.hit) {
      entry = found.entry;
      fromCache = true;
      cacheWarnings.push(...found.warnings);
    } else {
      const ask = (extraUser?: string) =>
        send<PaperSummary>(
          structured(template, vars, {
            schema,
            schemaName: PAPER_SUMMARY_SCHEMA_NAME,
            effort: SUMMARY_EFFORT,
            extraUser,
            step: extraUser === undefined ? "abstract" : "abstract-retry",
          }),
        );
      const first = overwriteIdentity(await ask(), "abstract");
      const kept = await groundFresh(first, prepared, () =>
        ask(GROUNDING_RETRY_INSTRUCTION),
      );
      entry = await deps.summaryCache.store(prepared.request, kept);
      fromCache = false;
    }
  } else {
    // -----------------------------------------------------------------------
    // The full-text paths
    // -----------------------------------------------------------------------
    const tier = source.tier;
    const fullTemplate = deps.prompts.get("PAPER_SUMMARY_FULLTEXT");
    const mapTemplate = deps.prompts.get("CHUNK_MAP");
    const reduceTemplate = deps.prompts.get("CHUNK_REDUCE");
    const fullSchema = schemaOf(fullTemplate);
    const reduceSchema = schemaOf(reduceTemplate);
    const scopeKind: InputScopeKind = "abstract+fulltext";

    const chunkModel: ChunkModel = {
      id: model.modelId,
      contextWindowTokens: info?.contextWindowTokens,
    };
    const rendersTo = (
      template: PromptTemplate,
      vars: Readonly<Record<string, string>>,
    ): number => {
      const rendered = renderPrompt(template, vars);
      return count(rendered.system) + count(rendered.user);
    };
    const singleNote = completenessNote(source, undefined, input.pageCounts);
    const fullMeta = (note: string): Record<string, string> => ({
      ...base,
      SOURCE_TIER: tier,
      COMPLETENESS_NOTE: note,
      JSON_SCHEMA: JSON.stringify(fullSchema),
    });
    const mapVars = (
      chunk: Pick<TextChunk, "index" | "total" | "section">,
      text: string,
    ): Record<string, string> => ({
      TITLE: base["TITLE"] as string,
      YEAR: base["YEAR"] as string,
      CHUNK_INDEX: String(chunk.index),
      CHUNK_TOTAL: String(chunk.total),
      SECTION: chunk.section,
      CHUNK_TEXT: text,
    });
    const overhead: ChunkPromptOverhead = {
      PAPER_SUMMARY_FULLTEXT: rendersTo(fullTemplate, {
        ...fullMeta(singleNote),
        FULL_TEXT: "",
      }),
      CHUNK_MAP: Math.max(
        ...[UNKNOWN_SECTION, "results+discussion"].map((section) =>
          rendersTo(
            mapTemplate,
            mapVars({ index: 99, total: 99, section }, ""),
          ),
        ),
      ),
    };
    const chunkSource = {
      itemKey: source.itemKey,
      abstract: source.abstract,
      text: source.text,
      sections: source.sections,
      // Flat until `P3-T22` and `G-22` rule (`plan/00` §6 item 300).
      sectionAware:
        deps.imradDetectorValidated === true ? source.sectionAware : false,
    };
    const planAt = (budgetScale: number): ChunkPlan =>
      planChunks(chunkSource, chunkModel, "PAPER_SUMMARY_FULLTEXT", {
        prompts: deps.prompts,
        overhead,
        countTokens: count,
        budgetScale,
      });

    const prepare = (plan: ChunkPlan): Prepared => {
      if (plan.kind === "single-shot") {
        const meta = fullMeta(singleNote);
        const contentHash = hashOf(source.text);
        return {
          promptId: "PAPER_SUMMARY_FULLTEXT",
          sentText: source.text,
          contentHash,
          tier,
          inputScope: {
            kind: scopeKind,
            charsSent: source.text.length,
            chunks: 1,
          },
          truncated: source.truncated,
          request: cacheRequest(
            "PAPER_SUMMARY_FULLTEXT",
            contentHash,
            tier,
            scopeKind,
            meta,
            fullTemplate.defaultTemperature,
          ),
          vars: { ...meta, FULL_TEXT: source.text },
          plan,
        };
      }
      const note = completenessNote(source, plan, input.pageCounts);
      const sent = chunkedSentText(source.text, plan);
      const contentHash = hashOf(sent);
      const reduceMeta: Record<string, string> = {
        ITEM_KEY: base["ITEM_KEY"] as string,
        TITLE: base["TITLE"] as string,
        AUTHORS: base["AUTHORS"] as string,
        YEAR: base["YEAR"] as string,
        VENUE: base["VENUE"] as string,
        SOURCE_TIER: tier,
        COMPLETENESS_NOTE: note,
        JSON_SCHEMA: JSON.stringify(reduceSchema),
        // The chunk layout (`docs/06` §11.2's note of 2026-10-28).
        CHUNKS: JSON.stringify(
          plan.chunks.map((chunk) => [chunk.section, chunk.start, chunk.end]),
        ),
      };
      return {
        promptId: "CHUNK_REDUCE",
        sentText: sent,
        contentHash,
        tier,
        inputScope: {
          kind: scopeKind,
          charsSent: sent.length,
          chunks: plan.chunks.length,
        },
        truncated: source.truncated || plan.truncated,
        request: cacheRequest(
          "CHUNK_REDUCE",
          contentHash,
          tier,
          scopeKind,
          reduceMeta,
          reduceTemplate.defaultTemperature,
        ),
        vars: reduceMeta,
        plan,
      };
    };

    const fullRequest = (vars: Prepared["vars"], extraUser?: string) =>
      structured(fullTemplate, vars, {
        schema: fullSchema,
        schemaName: PAPER_SUMMARY_SCHEMA_NAME,
        effort: SUMMARY_EFFORT,
        extraUser,
        step: extraUser === undefined ? "fulltext" : "fulltext-retry",
      });

    const runMaps = async (plan: ChunkedPlan): Promise<MapAnswer[]> => {
      const answers: MapAnswer[] = [];
      for (const chunk of plan.chunks) {
        const answer = await send<Record<string, unknown>>(
          structured(mapTemplate, mapVars(chunk, chunkText(chunk)), {
            schema: CHUNK_MAP_ANSWER_SCHEMA,
            schemaName: CHUNK_MAP_SCHEMA_NAME,
            step: `map-${String(chunk.index)}`,
          }),
        );
        answers.push({
          start: chunk.start,
          answer: {
            ...answer,
            chunkIndex: chunk.index,
            section: chunk.section,
          },
        });
      }
      // Document order for `CHUNK_REDUCE` (`plan/04` `P3-T25` note (1)).
      return answers.sort((a, b) => a.start - b.start);
    };

    type FirstPhase =
      | {
          readonly prepared: Prepared;
          readonly hit: CachedSummary<PaperSummary>;
          readonly warnings: readonly string[];
        }
      | { readonly prepared: Prepared; readonly single: PaperSummary }
      | { readonly prepared: Prepared; readonly maps: MapAnswer[] };

    const firstPhase = await runWithContextRetry<FirstPhase>(
      planAt,
      async (plan) => {
        const p = prepare(plan);
        const found = await lookup(p.request);
        if (found.hit) {
          return { prepared: p, hit: found.entry, warnings: found.warnings };
        }
        if (plan.kind === "single-shot") {
          return {
            prepared: p,
            single: await send<PaperSummary>(fullRequest(p.vars)),
          };
        }
        return { prepared: p, maps: await runMaps(plan) };
      },
    );
    prepared = firstPhase.prepared;

    if ("hit" in firstPhase) {
      entry = firstPhase.hit;
      fromCache = true;
      cacheWarnings.push(...firstPhase.warnings);
    } else {
      let first: PaperSummary;
      let retry: () => Promise<PaperSummary>;
      if ("single" in firstPhase) {
        first = firstPhase.single;
        retry = () =>
          send<PaperSummary>(
            fullRequest(prepared.vars, GROUNDING_RETRY_INSTRUCTION),
          );
      } else {
        // Outside `runWithContextRetry`: a context-length error here is not
        // halved and retried — that would only enlarge this input (`docs/06`
        // §5.3's note of 2026-10-28, item (5)). It fails the item.
        const reduceVars = {
          ...prepared.vars,
          CHUNK_RESULTS_JSON: JSON.stringify(
            firstPhase.maps.map((m) => m.answer),
          ),
        };
        // `CHUNKS` is keyed, not rendered: the template does not declare it.
        const renderVars = Object.fromEntries(
          Object.entries(reduceVars).filter(([name]) => name !== "CHUNKS"),
        );
        const reduce = (extraUser?: string) =>
          send<PaperSummary>(
            structured(reduceTemplate, renderVars, {
              schema: reduceSchema,
              schemaName: PAPER_SUMMARY_SCHEMA_NAME,
              effort: SUMMARY_EFFORT,
              extraUser,
              step: extraUser === undefined ? "reduce" : "reduce-retry",
            }),
          );
        first = await reduce();
        retry = () => reduce(GROUNDING_RETRY_INSTRUCTION);
      }
      const kept = await groundFresh(
        overwriteIdentity(first, prepared.tier),
        prepared,
        retry,
      );
      entry = await deps.summaryCache.store(prepared.request, kept);
      fromCache = false;
    }
  }

  return {
    kind: "summarized",
    ...(await finish({
      input,
      deps,
      prepared,
      entry,
      fromCache,
      usage: sumUsage(usages),
      warnings: [...cacheWarnings, ...rowWarnings],
    })),
    calls,
  };
}

/** What {@link finish} needs. */
interface FinishInput {
  readonly input: SummarizeItemInput;
  readonly deps: SummarizeItemDeps;
  readonly prepared: Prepared;
  readonly entry: CachedSummary<PaperSummary>;
  readonly fromCache: boolean;
  readonly usage: Usage | undefined;
  readonly warnings: readonly string[];
}

/**
 * Build the row from the cache entry, apply §12.1's marking on the payload as
 * stored, gate it and write it — or, on a hit whose row is already stored
 * for the same text, return that row unchanged (`docs/07` §5.2's note,
 * item 5).
 */
async function finish(
  args: FinishInput,
): Promise<{ readonly stored: StoredSummary; readonly fromCache: boolean }> {
  const { input, deps, prepared, entry, fromCache } = args;
  const { source } = input;
  const meta = entry.meta;
  const id = `${input.workKey}:${meta.promptVersion}:${meta.modelId}`;

  if (fromCache) {
    const existing = await deps.store.get(id);
    if (
      existing !== undefined &&
      existing.contentHash === prepared.contentHash &&
      existing.promptId === prepared.promptId
    ) {
      return { stored: existing, fromCache };
    }
  }

  const warnings = [...source.warnings, ...args.warnings];
  let content: PaperSummary = entry.summary;
  const grounding = checkGrounding(content, prepared.sentText);
  if (grounding.score !== null && grounding.score < GROUNDING_LOW_SCORE) {
    if (content.confidence !== "low")
      content = { ...content, confidence: "low" };
    warnings.push(GROUNDING_LOW_WARNING);
  }
  warnings.push(...checkNumeralInvariants(content, prepared.sentText).warnings);
  if (input.nonEnglish !== undefined) {
    content = applyNonEnglishPolicy(content, input.nonEnglish);
  }

  const row: UngatedStoredSummary = {
    id,
    workKey: input.workKey,
    zoteroItemKey: source.itemKey,
    content,
    inputScope: prepared.inputScope,
    promptId: meta.promptId as StoredSummaryPromptId,
    promptVersion: meta.promptVersion,
    providerId: meta.providerId,
    modelId: meta.modelId,
    temperature: meta.temperature,
    usage: fromCache ? undefined : args.usage,
    generatedAtEpochMs: meta.generatedAtEpochMs,
    sourceItemVersion: input.sourceItemVersion,
    contentHash: prepared.contentHash,
    truncated: prepared.truncated,
    groundingScore: grounding.score ?? undefined,
    warnings: [...new Set(warnings)],
    redaction: entry.redaction,
  };
  const stored = await deps.store.put(gateStoredSummary(row));
  return { stored, fromCache };
}

// ===========================================================================
// 6. The deps from a job's context
// ===========================================================================

/** What {@link summarizeItemDepsFrom} takes beside the context. */
export interface SummarizeItemExtras {
  /** `PROMPT_REGISTRY` (`src/prompts/bundled.ts`) in the product. */
  readonly prompts: Pick<PromptRegistry, "get" | "versions" | "cacheEpochs">;
  readonly store: Pick<SummaryStore, "put" | "get">;
  readonly modelInfo?: SummarizeItemDeps["modelInfo"];
  readonly modelConfirmed?: boolean;
  readonly imradDetectorValidated?: boolean;
}

/**
 * The deps one job's items share: one {@link SummaryCache} over
 * `ctx.cache`, built once (`summaryCache.ts`'s "Callers"), with
 * `cache.enabled` and `cache.ignoreModel` read through `ctx.config`.
 *
 * @param ctx - the job's context
 * @param extras - the registry, the store and the run's model facts
 */
export function summarizeItemDepsFrom(
  ctx: PipelineContext,
  extras: SummarizeItemExtras,
): SummarizeItemDeps {
  const summaryCache = createSummaryCache({
    cache: ctx.cache,
    promptVersions: extras.prompts.versions,
    promptCacheEpochs: extras.prompts.cacheEpochs,
    clock: ctx.clock,
    enabled: () => ctx.config.get("cacheEnabled"),
    ignoreModel: () => ctx.config.get("cacheIgnoreModel"),
    logger: ctx.logger,
  });
  return {
    llm: ctx.llm,
    budget: ctx.budget,
    token: ctx.token,
    privacy: ctx.privacy,
    config: ctx.config,
    prompts: extras.prompts,
    summaryCache,
    store: extras.store,
    clock: ctx.clock,
    logger: ctx.logger,
    traceId: ctx.jobId,
    ...(extras.modelInfo !== undefined && { modelInfo: extras.modelInfo }),
    ...(extras.modelConfirmed !== undefined && {
      modelConfirmed: extras.modelConfirmed,
    }),
    ...(extras.imradDetectorValidated !== undefined && {
      imradDetectorValidated: extras.imradDetectorValidated,
    }),
  };
}
