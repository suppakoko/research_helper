/**
 * The scripted, in-process LLM provider every Phase 3 unit test drives.
 *
 * **Scope.** `P3-T06` step 8. `docs/13-testing-build-and-release.md` §2.2's
 * `mockLLM(script)` shape — a provider that records each call and replays the
 * next scripted answer or error — rewritten against the shipped contract in
 * `src/llm/types.ts` (`docs/07` §4.3): `chat`, not `complete`; `ChatRequest`
 * and `ChatResponse`, not `LLMRequest` and `LLMResult`. Like §2.2's sketch, the
 * last step repeats once the script runs out, so a one-step script can answer a
 * 200-item job.
 *
 * **No network, no model, no key.** Nothing here imports the HTTP client or
 * the keystore. It does not import `vitest` either, so an integration spec can
 * use {@link mockLLMRouter} too.
 *
 * **What it honours from `LLMCallContext`**, so §2.2's scenarios can be built
 * on it:
 *
 * - a cancelled `token` throws `OperationCancelledError` before the call is
 *   recorded (cancel at 87/200);
 * - `budget.reserve()` runs before the call is recorded, with the heuristic
 *   input estimate and `maxOutputTokens`, and `budget.settle()` after a
 *   scripted success (budget stop);
 * - a scripted `Error` is thrown after the call is recorded (retry-then-succeed,
 *   context length, schema violation).
 */

import {
  createLLMProviderRegistry,
  type LLMSettings,
} from "../../src/llm/registry";
import { createLLMRouter } from "../../src/llm/router";
import { estTokens } from "../../src/llm/shared/tokenEstimate";
import type {
  ChatRequest,
  ChatResponse,
  ChatStreamChunk,
  CredentialCheckResult,
  LLMCallContext,
  LLMProvider,
  LLMRouter,
  ModelInfo,
} from "../../src/llm/types";
import type { ProviderId } from "../../src/model/ids";

/** One scripted answer: a response, an error, or a function producing either. */
export type MockStep =
  | ChatResponse
  | Error
  | ((call: MockCall) => ChatResponse | Error | Promise<ChatResponse | Error>);

/** One recorded call. */
export interface MockCall {
  /** 1-based position among the calls this provider recorded. */
  readonly index: number;
  readonly request: ChatRequest;
  readonly ctx: LLMCallContext;
}

/** Options for {@link mockLLM}. */
export interface MockLLMOptions {
  /** Defaults to `"openrouter"`, `docs/07` §8.5's default `llmProvider`. */
  readonly id?: ProviderId;
  /** What `isConfigured()` returns. Defaults to `true`. */
  readonly configured?: boolean;
  /** What `listModels()` returns. Defaults to two mock models, as §2.2. */
  readonly models?: readonly ModelInfo[];
  /** Give the provider a `chatStream` that splits each answer into words. */
  readonly streaming?: boolean;
}

/** A {@link mockLLM} provider: the contract plus what a test inspects. */
export interface MockLLMProvider extends LLMProvider {
  /** Every call that reached the script, in order. */
  readonly calls: readonly MockCall[];
  /** Script steps not yet consumed. `0` means the last step now repeats. */
  remaining(): number;
}

/**
 * A `ModelInfo` for tests.
 *
 * `supportsStreaming` defaults to `true` (`plan/00` §6 item 268(d)): with
 * `false` the router sends every `chatStream` to `chat`, so a `streaming: true`
 * mock's own stream was never reached and router.test.ts's pass-through test
 * passed on the fallback (`P3-T11` finding 2). Pass `false` to test the
 * fallback.
 */
export function mockModel(
  id: string,
  overrides: Partial<ModelInfo> = {},
): ModelInfo {
  return {
    id,
    displayName: id,
    contextWindowTokens: 128_000,
    maxOutputTokens: 8_000,
    supportsJsonSchema: true,
    supportsStreaming: true,
    supportsSystemPrompt: true,
    inputCostPerMTokUsd: undefined,
    outputCostPerMTokUsd: undefined,
    dataPolicy: {
      trainsOnInputByDefault: "unknown",
      retention: { days: "unknown", note: "mock" },
    },
    ...overrides,
  };
}

/** A `ChatResponse` for tests. `json` is parsed from `text` when it parses. */
export function chatResponse(
  text: string,
  overrides: Partial<ChatResponse> = {},
): ChatResponse {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return {
    text,
    json,
    model: "mock-small",
    finishReason: "stop",
    usage: {
      inputTokens: 10,
      outputTokens: estTokens(text),
      totalTokens: 10 + estTokens(text),
      costUsd: undefined,
    },
    servedBy: undefined,
    latencyMs: 1,
    raw: undefined,
    ...overrides,
  };
}

/**
 * Build a scripted provider.
 *
 * @param script - the answers, in call order; the last one repeats
 * @param options - see {@link MockLLMOptions}
 * @throws RangeError for an empty script
 */
export function mockLLM(
  script: readonly MockStep[],
  options: MockLLMOptions = {},
): MockLLMProvider {
  if (script.length === 0) {
    throw new RangeError("mockLLM needs at least one scripted step");
  }
  const calls: MockCall[] = [];
  let next = 0;

  async function replay(
    request: ChatRequest,
    ctx: LLMCallContext,
  ): Promise<ChatResponse> {
    ctx.token.throwIfCancelled();
    ctx.budget?.reserve({
      inputTokens: request.messages.reduce(
        (sum, message) => sum + estTokens(message.content),
        0,
      ),
      outputTokens: request.maxOutputTokens ?? 0,
    });
    const call: MockCall = { index: calls.length + 1, request, ctx };
    calls.push(call);
    const step = script[Math.min(next, script.length - 1)] as MockStep;
    next += 1;
    const outcome = typeof step === "function" ? await step(call) : step;
    if (outcome instanceof Error) throw outcome;
    ctx.budget?.settle(outcome.usage);
    return outcome;
  }

  const provider: MockLLMProvider = {
    id: options.id ?? "openrouter",
    displayNameKey: "rh-mock-provider",
    rateLimitKey: "mock.invalid",
    calls,
    remaining: () => Math.max(0, script.length - next),
    isConfigured: () => options.configured ?? true,
    validateCredentials(): Promise<CredentialCheckResult> {
      const ok = options.configured ?? true;
      return Promise.resolve({
        ok,
        messageKey: ok ? "rh-mock-ok" : "rh-mock-no-key",
      });
    },
    listModels(): Promise<readonly ModelInfo[]> {
      return Promise.resolve(
        options.models ?? [mockModel("mock-small"), mockModel("mock-large")],
      );
    },
    getModel(modelId: string): ModelInfo | undefined {
      return (
        options.models ?? [mockModel("mock-small"), mockModel("mock-large")]
      ).find((model) => model.id === modelId);
    },
    chat: replay,
    countTokens: (text: string) => estTokens(text),
  };

  if (options.streaming === true) {
    return {
      ...provider,
      async *chatStream(
        request: ChatRequest,
        ctx: LLMCallContext,
      ): AsyncIterable<ChatStreamChunk> {
        const response = await replay(request, ctx);
        const words = response.text.split(/(?<= )/);
        for (const word of words) {
          yield { deltaText: word, done: false };
        }
        yield { deltaText: "", done: true, usage: response.usage };
      },
    };
  }
  return provider;
}

/** Fixed settings for a test that does not go through a `PrefStore`. */
export function mockSettings(
  overrides: Partial<{
    activeProvider: ProviderId;
    keyPresent: Partial<Record<ProviderId, boolean>>;
    providerModel: Partial<Record<ProviderId, string>>;
    summaryModel: string;
    reportModel: string;
    screeningModel: string;
    baseUrl: Partial<Record<ProviderId, string>>;
  }> = {},
): LLMSettings {
  return {
    activeProvider: () => overrides.activeProvider ?? "openrouter",
    keyPresent: (id) => overrides.keyPresent?.[id] ?? false,
    providerModel: (id) =>
      overrides.providerModel?.[id] ?? `${id}-default-model`,
    summaryModel: () => overrides.summaryModel ?? "",
    reportModel: () => overrides.reportModel ?? "",
    screeningModel: () => overrides.screeningModel ?? "",
    baseUrl: (id) => overrides.baseUrl?.[id] ?? "",
  };
}

/**
 * A real `createLLMRouter` over a registry holding `providers`.
 *
 * With no arguments it is the router of a build with no key and no adapter:
 * every `chat` throws `MissingCredentialError` before any request. That is the
 * value a test gives `PipelineContext.llm` when its pipeline calls no LLM.
 */
export function mockLLMRouter(
  providers: readonly LLMProvider[] = [],
  settings: LLMSettings = mockSettings(),
): LLMRouter {
  const registry = createLLMProviderRegistry(settings);
  for (const provider of providers) registry.register(provider);
  return createLLMRouter({ registry, settings });
}
