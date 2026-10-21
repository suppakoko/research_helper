/**
 * `plan/00` §6 item 265 (d), owner, 2026-10-21 (recorded against item 176):
 * the NFR-10 startup test in `test/integration/phase1-dod.spec.ts` stops
 * counting Zotero's own hosts, and still counts every other new host and every
 * request the plugin sends. The classification it asserts with is
 * `test/integration/support/startupRequests.ts`, pure, so it is tested here in
 * Node. `phase1-dod.spec.ts`'s test "NFR-10's recorder reads the plugin's
 * User-Agent off a real channel…" checks inside Zotero that the recorder sees
 * the header these cases rely on.
 *
 * The URLs are SYNTHETIC; nothing is fetched.
 */

import { describe, expect, it } from "vitest";

import { buildUserAgent } from "../../../src/core/http/userAgent";
import {
  countedStartupHosts,
  hostOf,
  isPluginRequest,
  isZoteroOwnRequest,
  PLUGIN_USER_AGENT_PREFIX,
  ZOTERO_OWN_HOSTS,
  type ObservedRequest,
} from "../../integration/support/startupRequests";

/** The plugin's real `User-Agent`, as `createHttpClient` sets it (D10). */
const PLUGIN_UA = buildUserAgent("0.0.2");
/** Zotero's own, in the shape Gecko sends; any string without the prefix. */
const ZOTERO_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Zotero/10.0.3";

const RETRACTIONS = "https://api.zotero.org/retractions/list";

function zotero(url: string): ObservedRequest {
  return { url, userAgent: ZOTERO_UA };
}

function plugin(url: string): ObservedRequest {
  return { url, userAgent: PLUGIN_UA };
}

describe("NFR-10's startup request count (plan/00 §6 items 176, 265 (d))", () => {
  it("names api.zotero.org, and only it, as Zotero's own host", () => {
    expect(ZOTERO_OWN_HOSTS).toStrictEqual(["api.zotero.org"]);
    expect(PLUGIN_USER_AGENT_PREFIX).toBe("research_helper/");
    expect(PLUGIN_UA.startsWith(PLUGIN_USER_AGENT_PREFIX)).toBe(true);
  });

  it("does not count Zotero's own retractions/list download, the item 176 failure", () => {
    expect(isZoteroOwnRequest(zotero(RETRACTIONS))).toBe(true);
    expect(countedStartupHosts([], [zotero(RETRACTIONS)])).toStrictEqual([]);
    // A header that could not be read is not the plugin's either.
    expect(
      countedStartupHosts([], [{ url: RETRACTIONS, userAgent: undefined }]),
    ).toStrictEqual([]);
  });

  it("counts a request carrying the plugin's User-Agent, whatever its host, api.zotero.org included", () => {
    expect(isPluginRequest(plugin(RETRACTIONS))).toBe(true);
    expect(isZoteroOwnRequest(plugin(RETRACTIONS))).toBe(false);
    expect(countedStartupHosts([], [plugin(RETRACTIONS)])).toStrictEqual([
      "api.zotero.org",
    ]);
    expect(
      countedStartupHosts(
        [],
        [plugin("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi")],
      ),
    ).toStrictEqual(["eutils.ncbi.nlm.nih.gov"]);
  });

  it("counts a plugin request even when the control window saw the same host", () => {
    const baseline = [zotero("https://api.crossref.org/works")];
    expect(
      countedStartupHosts(baseline, [plugin("https://api.crossref.org/works")]),
    ).toStrictEqual(["api.crossref.org"]);
    // And Zotero's own request to that host stays explained by the control window.
    expect(
      countedStartupHosts(baseline, [zotero("https://api.crossref.org/works")]),
    ).toStrictEqual([]);
  });

  it("still counts every other new host, compared whole rather than by suffix or substring", () => {
    const others = [
      "https://www.zotero.org/download/",
      "https://zotero.org/",
      "https://api.zotero.org.example.test/retractions/list",
      "https://evil.test/?u=api.zotero.org",
      "https://api.zotero.org:8443/retractions/list",
      "https://example.test/",
    ];
    expect(countedStartupHosts([], others.map(zotero))).toStrictEqual([
      "www.zotero.org",
      "zotero.org",
      "api.zotero.org.example.test",
      "evil.test",
      "api.zotero.org:8443",
      "example.test",
    ]);
    // Only Zotero's https endpoint is excused; the evidence is https.
    expect(
      countedStartupHosts(
        [],
        [zotero("http://api.zotero.org/retractions/list")],
      ),
    ).toStrictEqual(["api.zotero.org"]);
  });

  it("excludes Zotero's host alongside, without hiding a new host seen with it", () => {
    expect(
      countedStartupHosts(
        [],
        [zotero(RETRACTIONS), zotero("https://new-host.test/x")],
      ),
    ).toStrictEqual(["new-host.test"]);
  });

  it("reads a host the way URL does: case-folded, default port dropped, a non-URL kept whole", () => {
    expect(hostOf("HTTPS://API.ZOTERO.ORG:443/retractions/list")).toBe(
      "api.zotero.org",
    );
    expect(
      countedStartupHosts([], [zotero("HTTPS://API.Zotero.org/x")]),
    ).toStrictEqual([]);
    expect(hostOf("not a url")).toBe("not a url");
    expect(countedStartupHosts([], [zotero("api.zotero.org")])).toStrictEqual([
      "api.zotero.org",
    ]);
  });
});
