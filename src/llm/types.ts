/**
 * The provider-agnostic LLM contract and the router's public surface.
 *
 * **Scope.** `P3-T06` step 1. Everything below is transcribed from
 * `docs/07-architecture-and-data-model.md` §4.3 — interface names, member
 * names, types, optionality and doc comments — because `plan/README.md` §5
 * rule 3 makes doc 07 the sole authority for types. `docs/03` §14.1's sketch
 * names (`complete`, `stream`, `validateKey`, `contextWindow`, `pricing`) are
 * working names under a "doc 07 wins" note and are deliberately absent.
 *
 * Section 2 is §4.3's second block, `LLMRouter` and its three helper types,
 * declared by the owner on 2026-10-21 (`plan/00` §6 item 248) before this file
 * was written. `src/llm/router.ts`'s `createLLMRouter` builds it, and
 * `src/pipeline/types.ts` re-exports it for `PipelineContext.llm` (§4.5).
 *
 * **`countTokens` is never exact at the call site.** It returns a bare number
 * with no `exact` flag (`docs/03` §10.2's authority note), so a caller treats
 * every result as an estimate and never gates a hard behaviour on it. The one
 * heuristic every adapter's `countTokens` delegates to is `estTokens` in
 * `./shared/tokenEstimate.ts`.
 *
 * **Layering.** `llm/` imports `core/` and `model/` only (§2.3). `ProviderId`
 * and `Usage` live in `model/` because `StoredSummary` and `TrendReport`
 * reference them; they are re-exported here so provider code has one import.
 */

import type { CancellationToken } from "../core/jobQueue/cancellation";
import type { ProgressReporter } from "../core/jobQueue/progress";
import type { ProviderId } from "../model/ids";
import type { Usage } from "../model/usage";

/**
 * `ProviderId` and `Usage` are declared in `model/` (§2.3, §5.1) because `StoredSummary`
 * and `TrendReport` reference them. Re-exported here so provider code has one import.
 */
export type { ProviderId, Usage };

// ===========================================================================
// 1. docs/07 §4.3, the LLMProvider contract
// ===========================================================================

export interface ModelInfo {
  /** Provider-native model identifier, e.g. "anthropic/claude-sonnet-5" on OpenRouter. */
  readonly id: string;
  readonly displayName: string;
  readonly contextWindowTokens: number;
  readonly maxOutputTokens: number;
  readonly supportsJsonSchema: boolean;
  readonly supportsStreaming: boolean;
  readonly supportsSystemPrompt: boolean;
  /** USD per 1M tokens; undefined when the provider does not publish it. */
  readonly inputCostPerMTokUsd: number | undefined;
  readonly outputCostPerMTokUsd: number | undefined;
  /**
   * Data-handling posture for this route, surfaced in the UI.
   * See 09-security-privacy-and-api-keys.md.
   */
  readonly dataPolicy: ModelDataPolicy;
}

export interface ModelDataPolicy {
  /** "no" = provider states it does not train on API data by default. */
  readonly trainsOnInputByDefault: "no" | "yes" | "unknown";
  /** Free-text retention description, plus a machine hint where known. */
  readonly retention: {
    readonly days: number | "zero" | "unknown";
    readonly note: string;
  };
  /** For OpenRouter: the upstream provider actually serving this route. */
  readonly upstreamProvider?: string;
  /** Link the UI shows next to the model. */
  readonly policyUrl?: string;
}

export type Role = "system" | "user" | "assistant";

export interface ChatMessage {
  readonly role: Role;
  readonly content: string;
}

/**
 * Reasoning / thinking effort on one shared scale (03 §14.1), the superset of every provider's:
 * `none` and `minimal` exist only so Gemini's lowest level has somewhere to land (03 §14.3).
 * Each adapter maps it onto its own provider's scale through a function; never forwarded blind.
 *
 * Declared by the owner on 2026-10-21 (`plan/00` §6 item 262(a); `docs/07` §4.3's dated note
 * "`ChatRequest.effort` and the shared `Effort` type"), replacing the adapters' local copies.
 */
export type Effort =
  "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface ChatRequest {
  readonly model: string;
  readonly messages: readonly ChatMessage[];
  readonly maxOutputTokens?: number;
  readonly temperature?: number;
  readonly topP?: number;
  readonly stop?: readonly string[];
  /** Absent: nothing is sent and the provider's own default applies. */
  readonly effort?: Effort;
  /** Request structured output. Providers without native support get prompt coercion. */
  readonly responseFormat?:
    | { readonly kind: "text" }
    | { readonly kind: "json" }
    | {
        readonly kind: "json_schema";
        readonly name: string;
        readonly schema: object;
      };
  /** Deterministic-ish sampling where supported. */
  readonly seed?: number;
  /**
   * Provider routing hints. OpenRouter uses these to restrict routes to
   * non-training / ZDR endpoints; other providers ignore unknown keys.
   */
  readonly routing?: ProviderRoutingHints;
  /** Opaque correlation ID written into logs, never sent upstream. */
  readonly traceId: string;
}

export interface ProviderRoutingHints {
  /** Refuse routes whose upstream may train on the data. */
  readonly requireNoTraining?: boolean;
  /** Refuse routes that retain prompts. */
  readonly requireZeroRetention?: boolean;
  /** Explicit allow/deny lists of upstream providers. */
  readonly allowProviders?: readonly string[];
  readonly denyProviders?: readonly string[];
}

export interface ChatResponse {
  readonly text: string;
  /** Populated when responseFormat requested JSON and parsing succeeded. */
  readonly json: unknown | undefined;
  readonly model: string;
  readonly finishReason:
    "stop" | "length" | "content_filter" | "tool_use" | "other";
  readonly usage: Usage;
  /** Which upstream actually served the request (OpenRouter exposes this). */
  readonly servedBy: string | undefined;
  readonly latencyMs: number;
  readonly raw: unknown;
}

export interface ChatStreamChunk {
  readonly deltaText: string;
  readonly done: boolean;
  readonly usage?: Usage;
}

export interface LLMCallContext {
  readonly token: CancellationToken;
  readonly progress?: ProgressReporter;
  readonly bypassCache?: boolean;
  /**
   * Enforced before the call; throws BudgetExceededError. The shared router
   * (`withBudget`) refuses a call without one with `ConfigurationError`
   * (owner, 2026-10-23, `plan/00` §6 item 278(a)); a call made on an adapter
   * directly, such as the key Test, needs none.
   */
  readonly budget?: BudgetGuard;
}

export interface LLMProvider {
  readonly id: ProviderId;
  readonly displayNameKey: string;
  readonly rateLimitKey: string;

  isConfigured(): boolean;
  /** "Test key" button in prefs. Cheapest possible authenticated call. */
  validateCredentials(ctx: LLMCallContext): Promise<CredentialCheckResult>;

  /** Models the provider currently offers. May hit the network; cached. */
  listModels(ctx: LLMCallContext): Promise<readonly ModelInfo[]>;
  /** Metadata for one model without a full list call, if known. */
  getModel(modelId: string): ModelInfo | undefined;

  chat(request: ChatRequest, ctx: LLMCallContext): Promise<ChatResponse>;
  /** Optional; router falls back to `chat` when absent. */
  chatStream?(
    request: ChatRequest,
    ctx: LLMCallContext,
  ): AsyncIterable<ChatStreamChunk>;

  /** Optional embeddings support (used by related/recommend when available). */
  embed?(
    input: readonly string[],
    options: { model: string },
    ctx: LLMCallContext,
  ): Promise<readonly (readonly number[])[]>;

  /** Best-effort token count for budgeting. Falls back to a heuristic. */
  countTokens(text: string, modelId: string): number;
}

export interface CredentialCheckResult {
  readonly ok: boolean;
  /** Never contains any part of the key. */
  readonly messageKey: string;
  readonly httpStatus?: number;
  /** Populated on success so the UI can immediately show model choices. */
  readonly models?: readonly ModelInfo[];
}

export interface BudgetGuard {
  /** Throws BudgetExceededError if the projected spend would breach the cap. */
  reserve(estimate: {
    inputTokens: number;
    outputTokens: number;
    costUsd?: number;
  }): void;
  /** Reconcile with actual usage after the call. */
  settle(usage: Usage): void;
  readonly spentUsd: number;
  readonly limitUsd: number | undefined;
}

// ===========================================================================
// 2. docs/07 §4.3, the router's public surface (owner, 2026-10-21, item 248)
// ===========================================================================

/** 12-prompt-library.md §18.5's tiers: an assignment table mapped onto two model settings. */
export type ModelTier = "cheap" | "standard" | "strong";

/** What a call is for: a tier, or relevance screening (`cheap` plus the `screening.model` override). */
export type ModelPurpose = ModelTier | "screening";

export interface ResolvedModel {
  readonly providerId: ProviderId;
  /** Provider-native model ID, ready for `ChatRequest.model`. */
  readonly modelId: string;
  /** The §8.5 key that supplied it, e.g. "summaryModel" or "openrouter.model". */
  readonly fromPref: string;
}

export interface LLMRouter {
  /** The configured provider (`llmProvider`). Never a fallback to another provider. */
  activeProvider(): ProviderId;
  /** The model for one purpose, from the active provider's chain. Throws ConfigurationError if every link is empty. */
  resolveModel(purpose: ModelPurpose): ResolvedModel;
  /** Dispatch to `activeProvider()`. Throws MissingCredentialError, with zero requests, when it has no key. */
  chat(request: ChatRequest, ctx: LLMCallContext): Promise<ChatResponse>;
  /** As `chat`, streamed. Without a provider `chatStream`, yields one terminal chunk built from `chat`. */
  chatStream(
    request: ChatRequest,
    ctx: LLMCallContext,
  ): AsyncIterable<ChatStreamChunk>;
}
