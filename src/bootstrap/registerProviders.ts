/**
 * `registerProviders` — builds the LLM layer once, at the composition root.
 *
 * **Scope.** `P3-T06` step 7. `docs/07` §2.2 names this file "LLMProvider +
 * TTSProvider registry population" and §11.2 step 9 makes it the single place
 * an LLM adapter is registered. It builds, in order: the settings port over
 * the typed preferences, the provider registry, the base-URL resolver and
 * `docs/07` §4.3's `LLMRouter`. `installServices` in
 * `src/bootstrap/container.ts` is its only production caller.
 *
 * **No adapter is registered yet.** `P3-T07`–`P3-T10` each add one here,
 * constructed with the `HttpClient`, the `SecretStore` and
 * {@link LLMServices.baseUrls}. Until then the router throws
 * `MissingCredentialError` (no key flag) or `ConfigurationError` (a key flag but
 * no adapter) before any request — which is the correct answer for a build
 * that can reach no provider. TTS providers are Phase 5's.
 *
 * **Why the settings are built here.** `llm/` may not import `src/prefs/`
 * (`docs/07` §2.3); `bootstrap/` may. {@link createPrefLLMSettings} is the one
 * mapping from a `ProviderId` to its `docs/07` §8.5 preference names, read
 * through `getPref` so every value is coerced and an invalid one falls back to
 * the schema default. Each getter reads on every call: a preference change
 * needs no restart.
 */

import type { Logger } from "../core/logger";
import {
  createBaseUrlResolver,
  type BaseUrlResolver,
} from "../llm/shared/baseUrl";
import {
  createLLMProviderRegistry,
  type LLMProviderRegistry,
  type LLMSettings,
} from "../llm/registry";
import { createLLMRouter } from "../llm/router";
import type { LLMRouter } from "../llm/types";
import type { ProviderId } from "../model/ids";
import { getPref, type PrefName } from "../prefs";

/** One provider's three per-provider preference names. */
interface ProviderPrefNames {
  readonly model: PrefName;
  readonly baseUrl: PrefName & `${string}BaseUrl`;
  readonly keyPresent: PrefName & `${string}KeyPresent`;
}

/**
 * Each `ProviderId`'s `docs/07` §8.5 rows. `satisfies` ties the keys to the
 * union, so a fifth provider fails to compile here until its rows exist.
 */
export const PROVIDER_PREF_NAMES = {
  openrouter: {
    model: "openrouterModel",
    baseUrl: "openrouterBaseUrl",
    keyPresent: "openrouterKeyPresent",
  },
  openai: {
    model: "openaiModel",
    baseUrl: "openaiBaseUrl",
    keyPresent: "openaiKeyPresent",
  },
  gemini: {
    model: "geminiModel",
    baseUrl: "geminiBaseUrl",
    keyPresent: "geminiKeyPresent",
  },
  anthropic: {
    model: "anthropicModel",
    baseUrl: "anthropicBaseUrl",
    keyPresent: "anthropicKeyPresent",
  },
} as const satisfies Record<ProviderId, ProviderPrefNames>;

/** Narrow `llmProvider`'s string to a `ProviderId`. */
function isProviderId(value: string): value is ProviderId {
  return Object.prototype.hasOwnProperty.call(PROVIDER_PREF_NAMES, value);
}

/**
 * The {@link LLMSettings} port over `src/prefs/index.ts`'s `getPref`.
 *
 * Works against whatever `PrefStore` is installed — the Zotero one in the
 * product, `createMemoryPrefStore()` in a test.
 */
export function createPrefLLMSettings(): LLMSettings {
  return {
    activeProvider(): ProviderId {
      const raw = getPref("llmProvider");
      // `getPref` already falls back to §8.5's default for a value outside the
      // row's closed set; this only narrows the type.
      return isProviderId(raw) ? raw : "openrouter";
    },
    keyPresent(providerId: ProviderId): boolean {
      return getPref(PROVIDER_PREF_NAMES[providerId].keyPresent);
    },
    providerModel(providerId: ProviderId): string {
      return getPref(PROVIDER_PREF_NAMES[providerId].model);
    },
    summaryModel(): string {
      return getPref("summaryModel");
    },
    reportModel(): string {
      return getPref("reportModel");
    },
    screeningModel(): string {
      return getPref("screeningModel");
    },
    baseUrl(providerId: ProviderId): string {
      return getPref(PROVIDER_PREF_NAMES[providerId].baseUrl);
    },
  };
}

/** What {@link registerProviders} needs. */
export interface ProviderWiringDeps {
  /** For refused base-URL overrides. */
  readonly logger: Logger;
  /** Defaults to {@link createPrefLLMSettings}. A test may pass its own. */
  readonly settings?: LLMSettings;
}

/** The LLM layer, as `installServices` holds it. */
export interface LLMServices {
  readonly settings: LLMSettings;
  readonly registry: LLMProviderRegistry;
  /** Handed to each adapter; `P3-T15` reads `effectiveHost` from it. */
  readonly baseUrls: BaseUrlResolver;
  /** `docs/07` §4.3's router — the value of every job's `PipelineContext.llm`. */
  readonly router: LLMRouter;
}

/**
 * Build the settings port, the registry, the base-URL resolver and the router.
 *
 * @param deps - see {@link ProviderWiringDeps}
 * @returns the four, for `installServices`
 */
export function registerProviders(deps: ProviderWiringDeps): LLMServices {
  const settings = deps.settings ?? createPrefLLMSettings();
  const registry = createLLMProviderRegistry(settings);
  const baseUrls = createBaseUrlResolver({
    override: (providerId) => settings.baseUrl(providerId),
    logger: deps.logger,
  });
  // `P3-T07`–`P3-T10` register their adapters here, before the router is
  // handed out.
  const router = createLLMRouter({ registry, settings });
  return { settings, registry, baseUrls, router };
}
