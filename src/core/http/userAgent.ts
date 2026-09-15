/**
 * Outbound identification: the `User-Agent` every request carries, and the
 * NCBI `tool` / `email` pair.
 *
 * **Scope.** `P0-T15` spike version. `plan/README.md` §4 lists
 * `src/core/http/userAgent.ts` among the sixteen paths a later card `create`s
 * again as the shipped module; nothing here is load-bearing. Crossref's
 * `mailto` (the user's `contactEmail` pref, maintainer otherwise) is Phase 2's
 * and is deliberately absent — `core/` reads no preference (docs/07 §2.3).
 *
 * The rules, all decision D10 (`docs/00` §3, confirmed 2026-09-09) with the
 * per-host table in `docs/02` §2.2:
 *
 * - The `User-Agent` carries the **maintainer** address on every request to
 *   every host. It is fixed at build time and is never a user's address.
 * - NCBI's `tool` / `email` parameters carry the maintainer address, always
 *   (NBK25497: the developer's address, "not that of a third-party end user").
 * - The build must fail rather than ship an unsubstituted placeholder
 *   (`docs/02` §2.2), which is why {@link buildUserAgent} validates the
 *   version it is given instead of accepting any string.
 */

/** The maintainer contact address. D10; published in every request. */
export const MAINTAINER_EMAIL = "suppakoko@gmail.com";

/** The project URL carried in the `User-Agent` comment. `docs/02` §2.2. */
export const PROJECT_URL = "https://github.com/suppakoko/research_helper";

/** The software name: the `User-Agent` product token and NCBI's `tool`. */
export const TOOL_NAME = "research_helper";

/** A semver core with an optional pre-release / build suffix. */
const VERSION_SHAPE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

/**
 * Build the one `User-Agent` string of `docs/02` §2.2:
 * `research_helper/<version> (https://github.com/suppakoko/research_helper; mailto:suppakoko@gmail.com)`.
 *
 * @param version - the plugin version, as the build substituted it
 * @returns the `User-Agent` header value
 * @throws RangeError if `version` is not a semver-shaped string, so an
 *   unsubstituted placeholder (`{{version}}`, `__buildVersion__`, empty) can
 *   never reach the wire
 */
export function buildUserAgent(version: string): string {
  if (!VERSION_SHAPE.test(version)) {
    throw new RangeError(
      `User-Agent version must be semver-shaped, got ${JSON.stringify(version)}`,
    );
  }
  return `${TOOL_NAME}/${version} (${PROJECT_URL}; mailto:${MAINTAINER_EMAIL})`;
}

/**
 * NCBI E-utilities etiquette parameters (`docs/02` §3.1, §2.2). Maintainer
 * address unconditionally — NCBI is D10's explicit exception to the per-user
 * contact scheme.
 */
export function ncbiIdentityParams(): Readonly<{
  tool: string;
  email: string;
}> {
  return { tool: TOOL_NAME, email: MAINTAINER_EMAIL };
}
