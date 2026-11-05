/**
 * `createLLMRouter` — the one entry point a pipeline calls an LLM through.
 *
 * **Scope.** `P3-T06` steps 3 and 4. The surface is `docs/07` §4.3's
 * `LLMRouter`, declared by the owner on 2026-10-21 (`plan/00` §6 item 248)
 * before this file was written; `PipelineContext.llm` (§4.5) is typed by it.
 * `src/bootstrap/registerProviders.ts` builds one router per plugin lifetime,
 * called from `installServices` in `src/bootstrap/container.ts`.
 *
 * **The model chains** (`docs/12` §18.5 and §3; `docs/07` §8.5). The first
 * non-empty link wins:
 *
 * | purpose | chain |
 * |---|---|
 * | `cheap`, `standard` | `summaryModel` → `<provider>.model` |
 * | `strong` | `reportModel` → `<provider>.model` |
 * | `screening` | `screening.model` → `summaryModel` → `<provider>.model` |
 *
 * There are two model settings, not three tiers: `screening.model` is an
 * opt-in override for `RELEVANCE_SCREEN` alone, and its chain never skips
 * `summaryModel`. When every link is empty — possible only if the user cleared
 * `<provider>.model`, whose §8.5 default is non-empty — the router throws
 * `ConfigurationError` rather than inventing a model ID (`plan/README.md` §5
 * rule 4).
 *
 * **Dispatch, and no silent failover** (`docs/09` §2.4 rule 6). `chat` and
 * `chatStream` go to the active provider (`llmProvider`) and nowhere else.
 * Before anything is sent, in this order:
 *
 * 1. a cancelled token throws `OperationCancelledError`;
 * 2. a provider whose `<provider>.keyPresent` is false throws
 *    `MissingCredentialError` (FR-33);
 * 3. a provider with a key flag but no registered adapter throws
 *    `ConfigurationError` — a build defect, not a missing key;
 * 4. an adapter whose own `isConfigured()` is false throws
 *    `MissingCredentialError`.
 *
 * Each of those throws before the adapter is called, so no request is issued.
 *
 * **Streaming** (`P3-T11`; `docs/07` §4.3's dated note "the streaming
 * contract"). `chatStream` calls the adapter's `chatStream` unless it has
 * none or its `getModel(request.model)` says `supportsStreaming: false`; then
 * it calls `chat` and yields one terminal chunk, under the stream's own
 * truncation rule (`terminalChunkOf` in `./shared/sse.ts`), so the caller
 * never branches. A model the adapter does not know streams.
 *
 * **Not here.** `LLMCallContext.budget` enforcement belongs to `P3-T16`.
 */

import { ConfigurationError, MissingCredentialError } from "../core/errors";
import type { ProviderId } from "../model/ids";

import type { LLMProviderRegistry, LLMSettings } from "./registry";
import { terminalChunkOf } from "./shared/sse";
import type {
  ChatRequest,
  ChatResponse,
  ChatStreamChunk,
  LLMCallContext,
  LLMProvider,
  LLMRouter,
  ModelPurpose,
  ResolvedModel,
} from "./types";

/** `docs/07` §8.5's key for the cheap/standard model setting. */
export const SUMMARY_MODEL_PREF = "summaryModel";
/** `docs/07` §8.5's key for the strong model setting. */
export const REPORT_MODEL_PREF = "reportModel";
/** `docs/07` §8.5's key for the screening override. */
export const SCREENING_MODEL_PREF = "screening.model";

/** `docs/07` §8.5's `<provider>.model` key. */
export function providerModelPref(providerId: ProviderId): string {
  return `${providerId}.model`;
}

/** What {@link createLLMRouter} needs. */
export interface LLMRouterDeps {
  /** The registry `registerProviders` filled. */
  readonly registry: LLMProviderRegistry;
  /** The same settings port the registry reads. */
  readonly settings: LLMSettings;
}

/** One link of a model chain: the §8.5 key and a getter for its value. */
interface ChainLink {
  readonly pref: string;
  readonly read: () => string;
}

/**
 * The chain for one purpose, in fallback order.
 *
 * @param purpose - what the call is for
 * @param providerId - the active provider
 * @param settings - the settings port
 */
function chainFor(
  purpose: ModelPurpose,
  providerId: ProviderId,
  settings: LLMSettings,
): readonly ChainLink[] {
  const summary: ChainLink = {
    pref: SUMMARY_MODEL_PREF,
    read: () => settings.summaryModel(),
  };
  const provider: ChainLink = {
    pref: providerModelPref(providerId),
    read: () => settings.providerModel(providerId),
  };
  switch (purpose) {
    case "cheap":
    case "standard":
      return [summary, provider];
    case "strong":
      return [
        { pref: REPORT_MODEL_PREF, read: () => settings.reportModel() },
        provider,
      ];
    case "screening":
      return [
        { pref: SCREENING_MODEL_PREF, read: () => settings.screeningModel() },
        summary,
        provider,
      ];
  }
}

/**
 * Build the router.
 *
 * @param deps - the registry and the settings port
 * @returns `docs/07` §4.3's {@link LLMRouter}
 */
export function createLLMRouter(deps: LLMRouterDeps): LLMRouter {
  const { registry, settings } = deps;

  /** The adapter to call, or the error that stops the call before any request. */
  function configuredProvider(ctx: LLMCallContext): LLMProvider {
    ctx.token.throwIfCancelled();
    const id = registry.activeProviderId();
    if (!settings.keyPresent(id)) {
      throw new MissingCredentialError(id);
    }
    const provider = registry.get(id);
    if (provider === undefined) {
      throw new ConfigurationError(
        `[research-helper] llmProvider is "${id}" but this build registers no adapter for it. ` +
          `docs/07 §11.2 step 9: adapters are registered in registerProviders.ts.`,
        { providerId: id },
      );
    }
    if (!provider.isConfigured()) {
      throw new MissingCredentialError(id);
    }
    return provider;
  }

  return {
    activeProvider(): ProviderId {
      return registry.activeProviderId();
    },

    resolveModel(purpose: ModelPurpose): ResolvedModel {
      const providerId = registry.activeProviderId();
      const chain = chainFor(purpose, providerId, settings);
      for (const link of chain) {
        const modelId = link.read().trim();
        if (modelId !== "") {
          return { providerId, modelId, fromPref: link.pref };
        }
      }
      throw new ConfigurationError(
        `[research-helper] no model is configured for "${purpose}" on "${providerId}": ` +
          `every preference in its chain is empty.`,
        { providerId, purpose, chain: chain.map((link) => link.pref) },
      );
    },

    async chat(
      request: ChatRequest,
      ctx: LLMCallContext,
    ): Promise<ChatResponse> {
      const provider = configuredProvider(ctx);
      await ctx.beforeSend?.();
      return provider.chat(request, ctx);
    },

    async *chatStream(
      request: ChatRequest,
      ctx: LLMCallContext,
    ): AsyncIterable<ChatStreamChunk> {
      const provider = configuredProvider(ctx);
      await ctx.beforeSend?.();
      // `P3-T11` step 4: an adapter without `chatStream`, or a model its
      // catalogue says cannot stream, gets `chat`. An unknown model streams.
      if (
        provider.chatStream !== undefined &&
        provider.getModel(request.model)?.supportsStreaming !== false
      ) {
        yield* provider.chatStream(request, ctx);
        return;
      }
      const response = await provider.chat(request, ctx);
      yield terminalChunkOf(provider.id, request, response);
    },
  };
}
