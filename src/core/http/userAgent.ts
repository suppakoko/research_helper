/**
 * Outbound identification: the `User-Agent` every request carries, and the
 * per-host contact parameters.
 *
 * **Scope.** `P1-T05`, the shipped module (`plan/README.md` §4 lists this path
 * among the sixteen a Phase 1 card `create`s again over `P0-T15`'s spike).
 * Crossref's `mailto` — the user's `contactEmail` pref, the maintainer address
 * otherwise — is {@link crossrefContactParams} (`P2-T04`, 2026-10-14): `core/`
 * reads no preference (`docs/07` §2.3), so the user's address arrives as an
 * argument from the composition root through the Crossref adapter.
 *
 * The rules, all decision D10 (`docs/00` §3, confirmed 2026-09-09) with the
 * per-host assignment table in `docs/02` §2.2:
 *
 * - The `User-Agent` carries the **maintainer** address on every request to
 *   every host. It is fixed at build time and is never a user's address.
 * - NCBI's `tool` / `email` parameters carry the maintainer address, always
 *   (NBK25497: the developer's address, "not that of a third-party end user").
 *   `src/core/http/client.ts` refuses a request to that host carrying anything
 *   else, so the rule is mechanical rather than remembered.
 * - The build must fail rather than ship an unsubstituted placeholder
 *   (`docs/02` §2.2), which is why {@link buildUserAgent} validates the version
 *   it is given instead of accepting any string.
 */

/** The maintainer contact address. D10; published in every request. */
export const MAINTAINER_EMAIL = "suppakoko@gmail.com";

/** The project URL carried in the `User-Agent` comment. `docs/02` §2.2. */
export const PROJECT_URL = "https://github.com/suppakoko/research_helper";

/** The software name: the `User-Agent` product token and NCBI's `tool`. */
export const TOOL_NAME = "research_helper";

/**
 * NCBI E-utilities, the one host whose contact parameters are fixed to the
 * maintainer address (`docs/02` §2.2's final assignment table, NBK25497).
 *
 * It is also `docs/07` §7.3's rate-limiter key, so `P1-T04`'s host registry and
 * this module name the same string.
 */
export const NCBI_EUTILS_HOST = "eutils.ncbi.nlm.nih.gov";

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

/** The contact query parameters a host receives, if any. */
export type ContactParams = Readonly<Record<string, string>>;

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

/**
 * The contact parameters for one host. `P1-T05` step 3.
 *
 * `docs/02` §2.2's final assignment table, restricted to what Phase 1 can
 * honestly answer:
 *
 * | Host | Parameters |
 * |---|---|
 * | `eutils.ncbi.nlm.nih.gov` | `tool` + `email`, maintainer, always |
 * | everything else | none |
 *
 * Europe PMC's `email=` and Crossref's `mailto=` rows are Phase 2's adapters
 * (`plan/03` `P2-T02`…), and Crossref's additionally depends on the
 * `contactEmail` pref that `core/` may not read. Adding either here would mean
 * inventing the slot before the adapter that fills it exists, so the function
 * returns an empty object and the table grows with the cards that need it.
 *
 * @param host - a URL host, compared case-insensitively
 * @returns the query parameters to add, possibly empty
 */
export function contactParamsForHost(host: string): ContactParams {
  return host.toLowerCase() === NCBI_EUTILS_HOST ? ncbiIdentityParams() : {};
}

/**
 * Crossref's `mailto` parameter (`P2-T04`): the **user's** address when the
 * `contactEmail` preference holds one, the maintainer's otherwise.
 *
 * Decision D10 (`docs/00` §3) and `docs/02` §2.2's final assignment table:
 * "Crossref — `mailto=` **user's, if set**; maintainer otherwise". The address
 * arrives as an argument because `core/` reads no preference (`docs/07` §2.3);
 * `src/bootstrap/container.ts` resolves `contactEmail` and the Crossref
 * adapter passes it through. `docs/02` §5.1 verified that a contact address in
 * **either** `mailto` or the `User-Agent` earns the polite pool, so an empty
 * preference costs the user nothing — the maintainer address goes out in the
 * parameter as well as in the `User-Agent` {@link buildUserAgent} builds, and
 * the two are never swapped: the user's address never reaches the
 * `User-Agent`, and the maintainer's never displaces a user's `mailto`.
 *
 * A value that is not address-shaped — blank, or carrying no `@` — is
 * treated as unset rather than sent, because Crossref reads the parameter and
 * a malformed one would identify nobody.
 *
 * @param userContactEmail - the `contactEmail` preference's value, if any
 * @returns the one `mailto` pair every Crossref request carries
 */
export function crossrefContactParams(
  userContactEmail: string | undefined,
): Readonly<{ mailto: string }> {
  const trimmed = userContactEmail?.trim() ?? "";
  const usable =
    trimmed.length > 0 && trimmed.includes("@") && !/\s/u.test(trimmed);
  return { mailto: usable ? trimmed : MAINTAINER_EMAIL };
}
