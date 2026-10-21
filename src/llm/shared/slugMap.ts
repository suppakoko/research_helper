/**
 * Native model ID → OpenRouter catalogue slug.
 *
 * **Scope.** `P3-T13` step 1. `./modelCatalogue.ts` uses the slug to look a
 * natively served model up in OpenRouter's public catalogue, the one
 * machine-readable source of context windows and prices for all four
 * providers (`docs/03` §9.4, "Design recommendation").
 *
 * **The rule** (`docs/03` §9.4, "The mapping is not pure prefixing"):
 * - OpenAI and Google: the author prefix, then the native ID unchanged
 *   (`gpt-5.6-terra` → `openai/gpt-5.6-terra`, `gemini-3.8-flash` →
 *   `google/gemini-3.8-flash`).
 * - Anthropic: the author prefix, then a **trailing** `-<major>-<minor>`
 *   rewritten to `-<major>.<minor>` (`claude-haiku-4-5` →
 *   `anthropic/claude-haiku-4.5`). Naive prefixing gives a slug the catalogue
 *   does not list.
 * - OpenRouter: its model IDs already are slugs, so they pass through.
 *
 * **Only a short version pair is rewritten.** Both parts must be one or two
 * digits, so a dated snapshot ID such as `claude-haiku-4-5-20251001` is left as
 * it is: §9.4 documents no slug for one, and a wrong guess would attach another
 * model's price. A slug the catalogue does not list leaves the enriched fields
 * `undefined` (`docs/03` §9.4: "degrade gracefully if a slug is missing").
 */

import type { ProviderId } from "../../model/ids";

/** OpenRouter's author prefix for each natively called provider. */
export const OPENROUTER_AUTHOR_PREFIX: Readonly<
  Record<Exclude<ProviderId, "openrouter">, string>
> = Object.freeze({
  openai: "openai",
  gemini: "google",
  anthropic: "anthropic",
});

/** A trailing `-<major>-<minor>`, each one or two digits. */
const TRAILING_VERSION_PAIR = /-(\d{1,2})-(\d{1,2})$/;

/** `docs/03` §9.3: Gemini names carry `models/`, which is stripped before use. */
const GEMINI_NAME_PREFIX = "models/";

/**
 * The OpenRouter catalogue slug for a provider's native model ID.
 *
 * @param providerId - the provider that serves `nativeId`
 * @param nativeId - the ID that provider's own models endpoint returns
 * @returns the slug, or `undefined` for an empty ID
 */
export function toOpenRouterSlug(
  providerId: ProviderId,
  nativeId: string,
): string | undefined {
  let id = nativeId.trim();
  if (providerId === "gemini" && id.startsWith(GEMINI_NAME_PREFIX)) {
    id = id.slice(GEMINI_NAME_PREFIX.length);
  }
  if (id === "") return undefined;
  if (providerId === "openrouter") return id;
  if (providerId === "anthropic") {
    id = id.replace(TRAILING_VERSION_PAIR, "-$1.$2");
  }
  return `${OPENROUTER_AUTHOR_PREFIX[providerId]}/${id}`;
}
