/**
 * Which requests seen during the plugin's startup window count against
 * `docs/10` NFR-10 ("No network request shall be issued at startup"), for
 * `../phase1-dod.spec.ts`'s test "NFR-10: startup adds a measurable, bounded
 * cost and issues no network request".
 *
 * **Changed 2026-10-21 (`plan/00` §6 item 265 (d), owner; recorded against
 * item 176).** The test watches `http-on-modify-request`, which fires for
 * every channel in the process, and Zotero's own requests fell inside the
 * plugin's startup window: item 176 saw Zotero's
 * `https://api.zotero.org/retractions/list` download counted once in three
 * runs on 2026-10-15, and item 265 in two of five runs on 2026-10-21. The
 * owner decided that the test stops counting Zotero's own hosts, named in
 * {@link ZOTERO_OWN_HOSTS}, and still counts every request the plugin sends.
 *
 * **What is still counted** by {@link countedStartupHosts}:
 *
 * - every request carrying the plugin's `User-Agent` (`docs/02` §2.2, D10:
 *   `src/core/http/client.ts` puts `research_helper/<version> (…)` on every
 *   request it sends, and discards a caller's own) — **whatever its host**,
 *   `api.zotero.org` included, and even when the same host was seen while the
 *   plugin was absent;
 * - every other request whose host was not seen in the control window (the
 *   plugin absent), unless that host is, exactly, one of
 *   {@link ZOTERO_OWN_HOSTS}. A host is compared whole — `zotero.org`,
 *   `www.zotero.org` or `api.zotero.org.example` are not on the list.
 *
 * Pure: no Zotero global, so `test/unit/integration/startupRequests.test.ts`
 * runs it in Node.
 */

import { TOOL_NAME } from "../../../src/core/http/userAgent";

/** One request the spec's `http-on-modify-request` observer saw. */
export interface ObservedRequest {
  /** The channel's `URI.spec`. */
  readonly url: string;
  /** The channel's `User-Agent` request header, if it could be read. */
  readonly userAgent: string | undefined;
}

/**
 * Zotero's own hosts: requests Zotero itself makes, which the NFR-10 test does
 * not count (`plan/00` §6 item 265 (d), owner, 2026-10-21).
 *
 * Add a host here **only with a run log** that shows Zotero — not the plugin
 * — requesting it inside the startup window, and cite the log beside it.
 *
 * - `api.zotero.org` — Zotero's retraction-list download,
 *   `https://api.zotero.org/retractions/list`. Seen counted on 2026-10-15
 *   (`plan/00` §6 item 176), in `P2-T26`'s run Z4, and in runs 1 and 4 of
 *   `plan/reports/after-hooks-264.md` (2026-10-21); 2 of 5 runs that day
 *   (item 265 (d)).
 */
export const ZOTERO_OWN_HOSTS: readonly string[] = ["api.zotero.org"];

/** The product token every plugin request's `User-Agent` starts with (D10). */
export const PLUGIN_USER_AGENT_PREFIX = `${TOOL_NAME}/`;

/**
 * A URL's host as `URL.host` gives it — lower case, with the port only when it
 * is not the scheme's default. A string that is not a URL is kept whole, so it
 * is still counted as a host of its own.
 */
export function hostOf(url: string): string {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return url;
  }
}

/** Whether the request carries the plugin's `User-Agent`. */
export function isPluginRequest(request: ObservedRequest): boolean {
  return (
    request.userAgent !== undefined &&
    request.userAgent.startsWith(PLUGIN_USER_AGENT_PREFIX)
  );
}

/**
 * Whether the request is Zotero's own: an `https:` URL whose host is on
 * {@link ZOTERO_OWN_HOSTS}, exactly, and not the plugin's `User-Agent`.
 */
export function isZoteroOwnRequest(request: ObservedRequest): boolean {
  if (isPluginRequest(request)) return false;
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return false;
  }
  return (
    url.protocol === "https:" &&
    ZOTERO_OWN_HOSTS.includes(url.host.toLowerCase())
  );
}

/**
 * The hosts that count against NFR-10, in first-seen order: see this file's
 * header. The test asserts the list is empty.
 *
 * @param baseline - requests seen while the plugin was absent
 * @param startup - requests seen while the plugin started
 * @returns the counted hosts; empty when startup was silent
 */
export function countedStartupHosts(
  baseline: readonly ObservedRequest[],
  startup: readonly ObservedRequest[],
): string[] {
  const baselineHosts = new Set(
    baseline
      .filter((request) => !isPluginRequest(request))
      .map((request) => hostOf(request.url)),
  );
  const counted = new Set<string>();
  for (const request of startup) {
    if (isPluginRequest(request)) {
      counted.add(hostOf(request.url));
      continue;
    }
    if (isZoteroOwnRequest(request)) continue;
    const host = hostOf(request.url);
    if (!baselineHosts.has(host)) counted.add(host);
  }
  return [...counted];
}
