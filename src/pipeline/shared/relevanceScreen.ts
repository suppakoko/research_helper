/**
 * `RELEVANCE_SCREEN` — score search results against the user's topic in
 * cheap batches (`docs/12` §3; `P3-T27` steps 6 and 7).
 *
 * **Caller.** The search pipeline's `Screening` stage,
 * `screenSearchResults` in `src/pipeline/searchImport/stages.ts`, which
 * `run` in `searchImportPipeline.ts` calls between `BackfillingAbstracts` and
 * `CreatingCollection` (`docs/07` §12.1's note of 2026-10-24). `docs/12` §3
 * places the screen *before* import ("to filter noisy multi-database results
 * before importing them into Zotero") and `docs/08` §4.2 draws its control in
 * the Search & Import window, so the search pipeline is its home.
 *
 * ## What one run does
 *
 * 1. Resolves the model through the router's `"screening"` purpose
 *    (`screening.model` → `summaryModel` → `<provider>.model`, `P3-T06`).
 * 2. Asks the job's {@link PrivacyPolicy} whether that model may be used,
 *    **before anything is sent**. A model whose data policy the adapter does
 *    not report is judged as `unknown`, never guessed; a model the mode lets
 *    through only after a confirmation is refused here, because a search has
 *    no confirmation to ask (`docs/09` §3.5's `full`-mode row).
 * 3. Splits the candidates into batches of at most
 *    {@link RELEVANCE_BATCH_MAX}, under {@link RELEVANCE_BATCH_INPUT_TOKEN_CAP}
 *    estimated input tokens each (`docs/12` §3, "10–20 candidates per call …
 *    under ~8 000 input tokens").
 * 4. Sends each batch through `completeJSON` with `docs/12` §3's
 *    `RelevanceScreen` schema, `budget: ctx.budget` (the shared router refuses
 *    a call without it, `plan/00` §6 item 278(a)) and the mode's routing
 *    hints.
 * 5. Checks the id round trip: the answer's ids must be exactly the batch's.
 *    A dropped, invented or repeated id discards the whole answer; the batch
 *    is re-run **once**, then each of its candidates gets its own call
 *    (`docs/12` §3, "re-run that batch once, then fall back to per-item calls
 *    for it"). A candidate whose own call fails too is **unscored**, and an
 *    unscored candidate is never excluded by a threshold — `docs/12` §3's
 *    "never hard-filter without showing the number".
 *
 * **Before a run** (owner, 2026-10-24, `plan/00` §6 item 281(b)):
 * {@link estimateRelevanceScreen} prices a screen with the same batching rule,
 * for the Search & Import window's cost line and `P3-T16`'s cost dialog.
 *
 * What is sent is each candidate's title, abstract, year, venue and item type
 * (`docs/12` §3's `{{CANDIDATES_JSON}}`), plus the user's topic: the
 * `abstract` input scope, which every privacy mode allows (`docs/09` §3.5).
 * No full text, note, annotation, tag or collection name is ever sent.
 *
 * **Layering.** `pipeline/` may import `llm/` and `prompts/` (`docs/07` §2.3).
 * The prompt template arrives as a parameter: `src/prompts/bundled.ts` is the
 * one module that imports a `.md` file and Vitest cannot load it.
 */

import {
  ConfigurationError,
  ContentFilterError,
  OperationCancelledError,
  OutputTruncatedError,
  PolicyViolationError,
  StructuredOutputError,
} from "../../core/errors";
import type { CancellationToken } from "../../core/jobQueue/cancellation";
import type { ProgressReporter } from "../../core/jobQueue/progress";
import type { Logger } from "../../core/logger";
import { completeJSON } from "../../llm/shared/jsonMode";
import { costOf, type ModelPrices } from "../../llm/shared/pricing";
import { estTokens } from "../../llm/shared/tokenEstimate";
import type {
  BudgetGuard,
  ChatRequest,
  LLMRouter,
  ModelInfo,
  ResolvedModel,
} from "../../llm/types";
import type { ProviderId } from "../../model/ids";
import {
  PROMPT_SCHEMAS,
  renderPrompt,
  resolveMaxTokens,
  type JsonSchemaObject,
  type PromptTemplate,
} from "../../prompts";
import type { ConfigReader } from "../types";
import { withHeadroom, type RunEstimate, type RunPlan } from "./estimate";
import {
  modelRouteFor,
  routingHints,
  type ModelPolicyCheck,
  type PrivacyPolicy,
} from "./privacyPolicy";

// ---------------------------------------------------------------------------
// 1. Constants — every number is docs/12 §3's
// ---------------------------------------------------------------------------

/** `docs/12` §3: "Screen **10–20 candidates per call**". The upper end. */
export const RELEVANCE_BATCH_MAX = 20;

/** `docs/12` §3: "Cap the batch so the total stays under ~8 000 input tokens." */
export const RELEVANCE_BATCH_INPUT_TOKEN_CAP = 8_000;

/** The schema file `docs/12` §3's "Expected output" ships as. */
export const RELEVANCE_SCHEMA_FILE = "relevance-screen.v1.json";

/** The `json_schema` name sent with the schema: the schema's own `title`. */
export const RELEVANCE_SCHEMA_NAME = "RelevanceScreen";

/**
 * The value `docs/12` §3 gives an optional variable that has nothing to say:
 * "Optional user text, or `none`". `{{INTERPRETATION}}` gets it too, until
 * `QUERY_EXPAND` exists to interpret the topic.
 */
export const RELEVANCE_NONE = "none";

// ---------------------------------------------------------------------------
// 2. Types
// ---------------------------------------------------------------------------

/** One search result, as `{{CANDIDATES_JSON}}` carries it. */
export interface ScreeningCandidate {
  /** Unique within one run; echoed back by the model and checked. */
  readonly id: string;
  readonly title: string;
  /** Absent or empty: the model scores from the title alone (§3 rule 3). */
  readonly abstract?: string | undefined;
  readonly year?: number | undefined;
  readonly venue?: string | undefined;
  readonly itemType?: string | undefined;
}

export type RelevanceConfidence = "high" | "medium" | "low";

/** `docs/12` §3's `flags` enumeration. */
export type RelevanceFlag =
  | "keyword_ambiguity"
  | "no_abstract"
  | "excluded_by_criterion"
  | "not_primary_research"
  | "prompt_injection_attempt";

/** One scored candidate. `reason` is the model's text: data, never markup. */
export interface RelevanceVerdict {
  readonly id: string;
  /** 0–100. */
  readonly score: number;
  readonly reason: string;
  readonly confidence: RelevanceConfidence;
  /** `false` is recorded, never acted on by dropping the item (§3). */
  readonly isPrimaryResearch: boolean;
  readonly flags: readonly RelevanceFlag[];
}

/** What the user asked about. Every member is untrusted text. */
export interface RelevanceScreenRequest {
  /** The user's topic: the search keyword. */
  readonly topic: string;
  readonly interpretation?: string | undefined;
  readonly inclusionCriteria?: string | undefined;
  readonly exclusionCriteria?: string | undefined;
}

/** What {@link screenRelevance} needs — the job's context, in pieces. */
export interface RelevanceScreenDeps {
  /** `PipelineContext.llm`: the budgeted router. */
  readonly llm: Pick<LLMRouter, "activeProvider" | "resolveModel" | "chat">;
  /** `PipelineContext.budget`, passed on **every** call. */
  readonly budget: BudgetGuard;
  readonly token: CancellationToken;
  /** `PipelineContext.privacy`. */
  readonly privacy: PrivacyPolicy;
  /** `PipelineContext.config`: `logRequestBodies` and `gemini.paidTier`. */
  readonly config: ConfigReader;
  /** The active `RELEVANCE_SCREEN` template. */
  readonly prompt: PromptTemplate;
  /** Defaults to {@link RELEVANCE_SCHEMA_FILE} from `PROMPT_SCHEMAS`. */
  readonly schema?: JsonSchemaObject;
  /**
   * The adapter's `ModelInfo` for the resolved model, for the privacy check.
   * Absent, or `undefined` for the model, means its data policy is judged
   * `unknown` — refused in strict mode, warned in balanced.
   */
  readonly modelInfo?: (
    providerId: ProviderId,
    modelId: string,
  ) => ModelInfo | undefined;
  /** Advanced once per candidate scored or given up on. */
  readonly progress?: ProgressReporter;
  readonly logger?: Logger;
  /** Prefix of each request's `traceId`. */
  readonly traceId?: string;
}

/** What one screening run produced. */
export interface RelevanceScreenResult {
  /** Every scored candidate, in candidate order. */
  readonly verdicts: readonly RelevanceVerdict[];
  /** Candidates no call could score, in candidate order. Never excluded. */
  readonly unscored: readonly string[];
  /** `undefined` only when there was nothing to screen. */
  readonly model: ResolvedModel | undefined;
  /** The privacy check's warnings, to show beside the result. */
  readonly policyWarnings: ModelPolicyCheck["warnings"];
  /** Batches sent, re-runs included, per-item calls not. */
  readonly batchCalls: number;
  /** Batches whose first answer failed the round trip and were re-run. */
  readonly rerunBatches: number;
  /** Single-candidate calls made after a re-run also failed. */
  readonly perItemCalls: number;
}

/** The parsed answer, as the schema guarantees it. */
interface RelevanceAnswer {
  readonly results: readonly {
    readonly id: string;
    readonly score: number;
    readonly reason: string;
    readonly confidence: RelevanceConfidence;
    readonly isPrimaryResearch: boolean;
    readonly flags?: readonly RelevanceFlag[];
  }[];
}

// ---------------------------------------------------------------------------
// 3. Pure helpers
// ---------------------------------------------------------------------------

/**
 * The candidates as `{{CANDIDATES_JSON}}`: exactly `docs/12` §3's six keys,
 * in its order, and nothing else — no identifier, author, note or tag.
 */
export function candidatesJson(batch: readonly ScreeningCandidate[]): string {
  return JSON.stringify(
    batch.map((c) => ({
      id: c.id,
      title: c.title,
      abstract: c.abstract ?? "",
      year: c.year ?? null,
      venue: c.venue ?? null,
      itemType: c.itemType ?? null,
    })),
  );
}

/** The template's variables for one batch. */
function variablesFor(
  request: RelevanceScreenRequest,
  batch: readonly ScreeningCandidate[],
): Record<string, string> {
  const orNone = (value: string | undefined): string =>
    value === undefined || value.trim() === "" ? RELEVANCE_NONE : value;
  return {
    USER_TOPIC: request.topic,
    INTERPRETATION: orNone(request.interpretation),
    INCLUSION_CRITERIA: orNone(request.inclusionCriteria),
    EXCLUSION_CRITERIA: orNone(request.exclusionCriteria),
    CANDIDATES_JSON: candidatesJson(batch),
  };
}

/** Estimated input tokens of one rendered batch: system plus user text. */
export function batchInputTokens(
  prompt: PromptTemplate,
  request: RelevanceScreenRequest,
  batch: readonly ScreeningCandidate[],
): number {
  const rendered = renderPrompt(prompt, variablesFor(request, batch));
  return estTokens(rendered.system) + estTokens(rendered.user);
}

/**
 * Split `candidates` into batches, in order: a batch is closed at
 * {@link RELEVANCE_BATCH_MAX} candidates, or before the candidate that would
 * take its measured size over `cap`. A candidate over the cap on its own is a
 * batch of one — it is sent whole, not truncated.
 *
 * @param candidates - in run order
 * @param measure - estimated input tokens of a batch
 * @param max - candidates per batch
 * @param cap - estimated input tokens per batch
 */
export function planBatches(
  candidates: readonly ScreeningCandidate[],
  measure: (batch: readonly ScreeningCandidate[]) => number,
  max: number = RELEVANCE_BATCH_MAX,
  cap: number = RELEVANCE_BATCH_INPUT_TOKEN_CAP,
): readonly (readonly ScreeningCandidate[])[] {
  const batches: ScreeningCandidate[][] = [];
  let current: ScreeningCandidate[] = [];
  for (const candidate of candidates) {
    const next = [...current, candidate];
    if (current.length > 0 && (next.length > max || measure(next) > cap)) {
      batches.push(current);
      current = [candidate];
    } else {
      current = next;
    }
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/**
 * `docs/12` §3's round-trip check: every candidate of the batch answered
 * exactly once, and no id that is not in the batch.
 */
export function roundTrips(
  batch: readonly ScreeningCandidate[],
  answer: RelevanceAnswer,
): boolean {
  const wanted = new Set(batch.map((c) => c.id));
  const seen = new Set<string>();
  for (const row of answer.results) {
    if (!wanted.has(row.id) || seen.has(row.id)) return false;
    seen.add(row.id);
  }
  return seen.size === wanted.size;
}

/**
 * The ids a threshold excludes: a **scored** candidate below it. `0` excludes
 * nothing (`docs/07` §8.5: "`0` disables screening's filtering effect while
 * still recording the scores"), and an unscored candidate is never here.
 *
 * @param verdicts - the scored candidates
 * @param threshold - the run's threshold, 0–100
 */
export function excludedIds(
  verdicts: readonly RelevanceVerdict[],
  threshold: number,
): readonly string[] {
  return verdicts.filter((v) => v.score < threshold).map((v) => v.id);
}

/** A `ModelInfo` for a model the adapter does not describe: policy `unknown`. */
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

/** The errors after which a batch is treated as answered wrongly. */
function isBatchFailure(error: unknown): boolean {
  return (
    error instanceof StructuredOutputError ||
    error instanceof ContentFilterError ||
    error instanceof OutputTruncatedError
  );
}

// ---------------------------------------------------------------------------
// 4. The run
// ---------------------------------------------------------------------------

/**
 * Score `candidates` against `request.topic`.
 *
 * @param candidates - unique ids, in run order
 * @param request - the topic and the optional criteria
 * @param deps - see {@link RelevanceScreenDeps}
 * @returns the verdicts and the unscored ids; never excludes anything itself
 * @throws ConfigurationError for repeated candidate ids or a missing schema,
 *   PolicyViolationError when the mode refuses the model (nothing is sent),
 *   OperationCancelledError on cancel, and any error a call throws other than
 *   a malformed, refused or truncated answer (a budget stop, a missing key, a
 *   network failure) — the caller decides what a failed screen means
 */
export async function screenRelevance(
  candidates: readonly ScreeningCandidate[],
  request: RelevanceScreenRequest,
  deps: RelevanceScreenDeps,
): Promise<RelevanceScreenResult> {
  const ids = new Set(candidates.map((c) => c.id));
  if (ids.size !== candidates.length) {
    throw new ConfigurationError(
      "screenRelevance: candidate ids must be unique, or the round trip cannot be checked",
      { candidates: candidates.length, unique: ids.size },
    );
  }
  if (candidates.length === 0) {
    return {
      verdicts: [],
      unscored: [],
      model: undefined,
      policyWarnings: [],
      batchCalls: 0,
      rerunBatches: 0,
      perItemCalls: 0,
    };
  }
  const found = deps.schema ?? PROMPT_SCHEMAS[RELEVANCE_SCHEMA_FILE];
  if (found === undefined) {
    throw new ConfigurationError(
      `screenRelevance: no schema file "${RELEVANCE_SCHEMA_FILE}" is registered`,
    );
  }
  const schema: JsonSchemaObject = found;
  deps.token.throwIfCancelled();

  // Steps 1–2: the model, and the mode's verdict on it, before any request.
  const model = deps.llm.resolveModel("screening");
  const mode = deps.privacy.mode;
  const info =
    deps.modelInfo?.(model.providerId, model.modelId) ??
    unknownPolicyModel(model.modelId);
  const check = deps.privacy.assertModelAllowed(
    info,
    mode,
    modelRouteFor(model.providerId, () => deps.config.get("geminiPaidTier")),
  );
  if (check.requiresConfirmation) {
    throw new PolicyViolationError(
      `model "${model.modelId}" needs the user's confirmation in ${mode} privacy ` +
        "mode, and a search asks none: relevance screening is not run (docs/09 §3.5)",
      { mode, modelId: model.modelId },
    );
  }
  const routing = routingHints(mode);
  const includeBodies = deps.config.get("logRequestBodies");

  const verdicts = new Map<string, RelevanceVerdict>();
  const unscored = new Set<string>();
  let batchCalls = 0;
  let rerunBatches = 0;
  let perItemCalls = 0;
  let done = 0;
  const total = candidates.length;
  deps.progress?.setProgress(0, total);
  const advance = (n: number): void => {
    done += n;
    deps.progress?.setProgress(done, total);
  };

  /** One call; `undefined` when the answer failed the round trip or the schema. */
  async function ask(
    batch: readonly ScreeningCandidate[],
    label: string,
  ): Promise<RelevanceAnswer | undefined> {
    deps.token.throwIfCancelled();
    const rendered = renderPrompt(deps.prompt, variablesFor(request, batch));
    const chat: ChatRequest & {
      responseFormat: { kind: "json_schema"; name: string; schema: object };
    } = {
      model: model.modelId,
      messages: [
        { role: "system", content: rendered.system },
        { role: "user", content: rendered.user },
      ],
      temperature: deps.prompt.defaultTemperature,
      maxOutputTokens: resolveMaxTokens(deps.prompt, batch.length),
      responseFormat: {
        kind: "json_schema",
        name: RELEVANCE_SCHEMA_NAME,
        schema,
      },
      routing,
      traceId: `${deps.traceId ?? "relevance"}:${label}`,
    };
    try {
      const completed = await completeJSON<RelevanceAnswer>(
        deps.llm,
        chat,
        { token: deps.token, budget: deps.budget },
        { includeBodies },
      );
      if (roundTrips(batch, completed.value)) return completed.value;
      deps.logger?.warn(
        "relevance screening: an answer did not return exactly the batch's ids",
        { batch: batch.length, returned: completed.value.results.length },
      );
      return undefined;
    } catch (error) {
      if (error instanceof OperationCancelledError) throw error;
      if (isBatchFailure(error)) {
        deps.logger?.warn("relevance screening: a batch was answered wrongly", {
          batch: batch.length,
          error: (error as Error).name,
        });
        return undefined;
      }
      throw error;
    }
  }

  function record(answer: RelevanceAnswer): void {
    for (const row of answer.results) {
      verdicts.set(row.id, {
        id: row.id,
        score: row.score,
        reason: row.reason,
        confidence: row.confidence,
        isPrimaryResearch: row.isPrimaryResearch,
        flags: row.flags ?? [],
      });
    }
  }

  const batches = planBatches(candidates, (batch) =>
    batchInputTokens(deps.prompt, request, batch),
  );
  for (const [at, batch] of batches.entries()) {
    batchCalls += 1;
    let answer = await ask(batch, `batch-${String(at + 1)}`);
    if (answer === undefined) {
      // §3: "re-run that batch once, then fall back to per-item calls for it".
      rerunBatches += 1;
      batchCalls += 1;
      answer = await ask(batch, `batch-${String(at + 1)}-rerun`);
    }
    if (answer !== undefined) {
      record(answer);
      advance(batch.length);
      continue;
    }
    for (const candidate of batch) {
      perItemCalls += 1;
      const single = await ask([candidate], `item-${candidate.id}`);
      if (single === undefined) unscored.add(candidate.id);
      else record(single);
      advance(1);
    }
  }

  return {
    verdicts: candidates.flatMap((c) => {
      const verdict = verdicts.get(c.id);
      return verdict === undefined ? [] : [verdict];
    }),
    unscored: candidates.filter((c) => unscored.has(c.id)).map((c) => c.id),
    model,
    policyWarnings: check.warnings,
    batchCalls,
    rerunBatches,
    perItemCalls,
  };
}

// ---------------------------------------------------------------------------
// 5. The estimate before a screen runs — plan/00 §6 item 281(b)
// ---------------------------------------------------------------------------

/** What {@link estimateRelevanceScreen} is given. */
export interface RelevanceScreenEstimateInput {
  /**
   * How many results would be scored. Before a search runs this is the most
   * it can return (`docs/08` §4.2's note of 2026-10-24); merging only lowers it.
   */
  readonly resultCount: number;
  /** The topic, so the prompt's own tokens are measured as they will be sent. */
  readonly request: RelevanceScreenRequest;
  /** The active `RELEVANCE_SCREEN` template. */
  readonly prompt: PromptTemplate;
  /** The `"screening"` model. */
  readonly modelId: string;
  /** Its prices from the graph's `modelPrices`; `undefined` when unknown. */
  readonly prices: ModelPrices | undefined;
  /** When the screen would run, for a promotion's end date (`costOf`). */
  readonly atEpochMs: number;
}

/**
 * Price a screen of `resultCount` results before it runs (`docs/12` §3's note
 * of 2026-10-24; owner, `plan/00` §6 item 281(b)).
 *
 * - **Calls** follow {@link planBatches}, the rule {@link screenRelevance}
 *   sends with. Each result is assumed to take its share of a full batch —
 *   (the cap − the prompt's own tokens) ÷ {@link RELEVANCE_BATCH_MAX}, rounded
 *   down — so a batch of 20 fills the cap and the plan makes one call per 20
 *   results, rounded up. A re-run or a per-item call is not counted: both
 *   follow only a malformed answer.
 * - **Input** per call is the prompt's own tokens (this template rendered
 *   with the topic and no candidate) plus its results' share, times D-06-5's
 *   1.15 ({@link withHeadroom}), as `P3-T16`'s estimate does.
 * - **Output** per call is the prompt's ceiling, `resolveMaxTokens` for the
 *   call's results: never a typical fill.
 * - **Dollars** per call through `costOf`; with no price the cost is
 *   `undefined`, never `0`.
 *
 * The result is `P3-T16`'s {@link RunEstimate}, so the cost dialog shows it
 * unchanged: every result is sent as an abstract, nothing is cached, and the
 * abstract-only plan is the same plan (there is nothing to downgrade).
 *
 * @param input - see {@link RelevanceScreenEstimateInput}
 * @returns the estimate; a `resultCount` that is not a positive number plans
 *   no call
 */
export function estimateRelevanceScreen(
  input: RelevanceScreenEstimateInput,
): RunEstimate {
  const count =
    Number.isFinite(input.resultCount) && input.resultCount > 0
      ? Math.floor(input.resultCount)
      : 0;
  const overhead = batchInputTokens(input.prompt, input.request, []);
  const share = Math.max(
    0,
    Math.floor(
      (RELEVANCE_BATCH_INPUT_TOKEN_CAP - overhead) / RELEVANCE_BATCH_MAX,
    ),
  );
  const placeholders: ScreeningCandidate[] = Array.from(
    { length: count },
    (_, at) => ({ id: String(at), title: "" }),
  );
  const batches = planBatches(
    placeholders,
    (batch) => overhead + batch.length * share,
  );
  let rawInputTokens = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd: number | undefined = input.prices === undefined ? undefined : 0;
  for (const batch of batches) {
    const raw = overhead + batch.length * share;
    const budgeted = withHeadroom(raw);
    const output = resolveMaxTokens(input.prompt, batch.length);
    rawInputTokens += raw;
    inputTokens += budgeted;
    outputTokens += output;
    if (costUsd !== undefined && input.prices !== undefined) {
      const cost = costOf(
        input.prices,
        { inputTokens: budgeted, outputTokens: output },
        input.atEpochMs,
      ).costUsd;
      costUsd = cost === undefined ? undefined : costUsd + cost;
    }
  }
  const plan: RunPlan = {
    fullTextMode: "never",
    items: [],
    counts: {
      items: count,
      cached: 0,
      fullText: 0,
      abstractOnly: count,
      metadataOnly: 0,
      chunked: 0,
    },
    calls: batches.length,
    rawInputTokens,
    inputTokens,
    outputTokens,
    costUsd,
  };
  return {
    modelId: input.modelId,
    selected: plan,
    abstractOnly: plan,
    preselectDowngrade: false,
    pricesAsOfEpochMs: input.prices?.asOfEpochMs,
    isEstimate: true,
  };
}
