/**
 * The LLM provider registry, and the settings port the LLM layer reads.
 *
 * **Scope.** `P3-T06` step 2: register adapters by `ProviderId`, read the
 * active provider from `llmProvider`, and say per provider whether it is
 * configured from its `<provider>.keyPresent` flag (`docs/07` §8.5). The
 * composition root fills it once, in `src/bootstrap/registerProviders.ts`
 * (`docs/07` §11.2 step 9); `P3-T07`–`P3-T10` add one adapter each.
 *
 * **Why a settings port instead of `getPref`.** `llm/` imports `core/` and
 * `model/` only (`docs/07` §2.3), so it cannot import `src/prefs/`. It reads
 * through {@link LLMSettings}, which `registerProviders.ts` builds from the
 * typed, coerced `getPref`, and which a test can build from a stubbed
 * `PrefStore` through that same function. Every member is a getter called on
 * each read, so a preference change needs no restart.
 *
 * **D5.** Nothing here reads, holds or logs a key. "Configured" is the
 * `*.keyPresent` boolean (`docs/09` §1.7) plus the adapter's own
 * `isConfigured()`; the key itself stays in the keystore until an adapter's
 * header-building function asks for it.
 */

import type { ProviderId } from "../model/ids";

import type { LLMProvider } from "./types";

/**
 * Every LLM preference the `llm/` layer reads, as getters.
 *
 * One member per `docs/07` §8.5 row in "LLM providers & models" and the
 * key-presence block. The model getters return the raw stored string, `""`
 * when unset, so the router can walk its fallback chain.
 */
export interface LLMSettings {
  /** `llmProvider`. */
  activeProvider(): ProviderId;
  /** `<provider>.keyPresent`. A boolean only; never the key. */
  keyPresent(providerId: ProviderId): boolean;
  /** `<provider>.model`. */
  providerModel(providerId: ProviderId): string;
  /** `summaryModel` — `cheap` and `standard`. */
  summaryModel(): string;
  /** `reportModel` — `strong`. */
  reportModel(): string;
  /** `screening.model` — relevance screening only. */
  screeningModel(): string;
  /** `<provider>.baseUrl`, raw; `./shared/baseUrl.ts` validates it. */
  baseUrl(providerId: ProviderId): string;
}

/** The registry `registerProviders` fills and the router dispatches through. */
export interface LLMProviderRegistry {
  /**
   * Add an adapter. Throws if one is already registered under the same `id`:
   * two adapters for one provider means one is unreachable.
   */
  register(provider: LLMProvider): void;
  /** The adapter for `id`, or `undefined` if this build has none. */
  get(id: ProviderId): LLMProvider | undefined;
  /** Every registered adapter, in registration order. */
  list(): readonly LLMProvider[];
  /** The configured provider, `llmProvider` — read on every call. */
  activeProviderId(): ProviderId;
  /**
   * Whether `id` can be called now: its `<provider>.keyPresent` flag is set,
   * an adapter is registered, and that adapter's own `isConfigured()` agrees.
   * Read on every call, never cached.
   */
  isConfigured(id: ProviderId): boolean;
}

/**
 * Create an empty registry over `settings`.
 *
 * @param settings - the settings port; see {@link LLMSettings}
 * @returns an empty {@link LLMProviderRegistry}
 */
export function createLLMProviderRegistry(
  settings: LLMSettings,
): LLMProviderRegistry {
  const providers = new Map<ProviderId, LLMProvider>();

  return {
    register(provider: LLMProvider): void {
      if (providers.has(provider.id)) {
        throw new Error(
          `[research-helper] an LLM provider is already registered for "${provider.id}". ` +
            `docs/07 §11.2 step 9 makes registerProviders.ts the single wiring point; ` +
            `registering twice usually means the composition root ran twice.`,
        );
      }
      providers.set(provider.id, provider);
    },

    get(id: ProviderId): LLMProvider | undefined {
      return providers.get(id);
    },

    list(): readonly LLMProvider[] {
      return [...providers.values()];
    },

    activeProviderId(): ProviderId {
      return settings.activeProvider();
    },

    isConfigured(id: ProviderId): boolean {
      if (!settings.keyPresent(id)) return false;
      const provider = providers.get(id);
      return provider !== undefined && provider.isConfigured();
    },
  };
}
