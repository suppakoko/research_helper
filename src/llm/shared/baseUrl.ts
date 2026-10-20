/**
 * Base-URL resolution for the four LLM providers — the one place a provider's
 * base URL is written down.
 *
 * **Scope.** `P3-T06` step 5. `docs/03-llm-provider-integration.md` §14.4's
 * closing paragraph: "Base URLs are resolved here, not hardcoded in the
 * adapters. Each adapter asks for its base URL and gets `<provider>.baseUrl`
 * when that preference is non-empty, and the base URL documented in this
 * document otherwise." An adapter (`P3-T07`–`P3-T10`) is handed a
 * {@link BaseUrlResolver} by `src/bootstrap/registerProviders.ts` and holds no
 * literal URL of its own.
 *
 * **The defaults** are transcribed from `docs/03` §2.1 (OpenAI), §3.1
 * (Anthropic), §4.1 (Gemini) and §5.1 (OpenRouter), each a "Base:" line.
 *
 * **What an override must be.** `docs/07` §8.5's `<provider>.baseUrl` rows:
 * "an absolute `https://` URL with no trailing slash, or empty". `docs/03`
 * §14.4 adds that the override carries no credential of its own. So a stored
 * value is used only when it parses as a URL, its scheme is `https:`, and it
 * has no user name, password, query or fragment. A trailing slash is removed
 * rather than refused, because refusing it would send the call to the
 * documented host instead of the gateway the user named. Any other value is
 * refused: the documented default is used and one `warn` line is logged per
 * provider and refused value — naming the provider and the reason, never the
 * value, which may hold a credential.
 *
 * **Read on every call.** The override is a getter, so a preference change
 * needs no restart. `llm/` may not import `src/prefs/` (`docs/07` §2.3); the
 * composition root passes the getter in.
 *
 * **The effective host** ({@link BaseUrlResolver.effectiveHost}) is what the
 * pre-flight egress dialog names (`docs/03` §14.4, `docs/09` §3.6): the host a
 * key will actually be sent to. `P3-T15` reads it.
 */

import type { Logger } from "../../core/logger";
import type { ProviderId } from "../../model/ids";

/** Each provider's documented base URL, `docs/03` §2.1, §3.1, §4.1, §5.1. */
export const DEFAULT_BASE_URLS: Readonly<Record<ProviderId, string>> =
  Object.freeze({
    openrouter: "https://openrouter.ai/api/v1",
    openai: "https://api.openai.com/v1",
    gemini: "https://generativelanguage.googleapis.com",
    anthropic: "https://api.anthropic.com",
  });

/** What {@link createBaseUrlResolver} needs. */
export interface BaseUrlResolverDeps {
  /** The raw `<provider>.baseUrl` preference value; `""` means "not set". */
  readonly override: (providerId: ProviderId) => string;
  /** Where a refused override is reported, once per provider and value. */
  readonly logger?: Logger;
}

/** The resolver an adapter is handed. */
export interface BaseUrlResolver {
  /** The base URL to build request URLs from: a valid override, else the default. No trailing slash. */
  resolveBaseUrl(providerId: ProviderId): string;
  /** The lower-case host (with port, if any) of {@link resolveBaseUrl}'s answer. */
  effectiveHost(providerId: ProviderId): string;
}

/** Why an override was refused, for the log line. */
type RefusalReason =
  "not-a-url" | "not-https" | "carries-credentials" | "has-query-or-fragment";

/**
 * Check one override. Returns the normalized URL, or why it was refused.
 *
 * @param raw - the stored value, already known to be non-empty after trimming
 */
function checkOverride(
  raw: string,
): { url: string } | { refused: RefusalReason } {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { refused: "not-a-url" };
  }
  if (parsed.protocol !== "https:" || parsed.host === "") {
    return { refused: "not-https" };
  }
  if (parsed.username !== "" || parsed.password !== "") {
    return { refused: "carries-credentials" };
  }
  if (parsed.search !== "" || parsed.hash !== "") {
    return { refused: "has-query-or-fragment" };
  }
  const path = parsed.pathname.replace(/\/+$/, "");
  return { url: `${parsed.protocol}//${parsed.host}${path}` };
}

/**
 * Build the resolver.
 *
 * @param deps - the override getter and an optional logger
 * @returns a {@link BaseUrlResolver}
 */
export function createBaseUrlResolver(
  deps: BaseUrlResolverDeps,
): BaseUrlResolver {
  // One line per provider and refused value. Keyed by provider + value so a
  // second, different bad value is reported too; the value never reaches the log.
  const reported = new Set<string>();

  function resolveBaseUrl(providerId: ProviderId): string {
    const fallback = DEFAULT_BASE_URLS[providerId];
    let raw: string;
    try {
      raw = deps.override(providerId).trim();
    } catch {
      return fallback;
    }
    if (raw === "") return fallback;

    const checked = checkOverride(raw);
    if ("url" in checked) return checked.url;

    const key = `${providerId}\u0000${raw}`;
    if (!reported.has(key)) {
      reported.add(key);
      deps.logger?.warn(
        "refused a <provider>.baseUrl override and used the documented base URL " +
          "(docs/07 §8.5: an absolute https:// URL with no credentials, or empty)",
        { providerId, reason: checked.refused },
      );
    }
    return fallback;
  }

  return {
    resolveBaseUrl,
    effectiveHost(providerId: ProviderId): string {
      return new URL(resolveBaseUrl(providerId)).host.toLowerCase();
    },
  };
}
