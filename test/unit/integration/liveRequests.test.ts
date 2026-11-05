/**
 * `plan/00` §6 item 347(c), 2026-11-05: which requests the suite's live request guard
 * (`test/integration/support/liveRequestGuard.ts`) cancels. The observer itself runs
 * only in Zotero, and `_suite-guards.spec.ts` tests it on a real channel.
 *
 * The URLs are SYNTHETIC; nothing is fetched.
 */

import { describe, expect, it } from "vitest";

import { buildUserAgent } from "../../../src/core/http/userAgent";
import {
  isLiveRequest,
  LIVE_SERVICE_HOSTS,
} from "../../integration/support/liveRequestGuard";

const PLUGIN_UA = buildUserAgent("0.0.2");
const ZOTERO_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Zotero/10.0.3";

describe("isLiveRequest", () => {
  it("is true for the plugin's User-Agent on any host but loopback", () => {
    for (const url of [
      "https://example.invalid/x",
      "https://api.zotero.org/retractions/list",
      "https://api.crossref.org/works?mailto=a@b.c",
    ]) {
      expect(isLiveRequest({ url, userAgent: PLUGIN_UA })).toBe(true);
    }
  });

  it("is true for every listed service, whatever the User-Agent", () => {
    expect(LIVE_SERVICE_HOSTS.length).toBeGreaterThan(0);
    for (const host of LIVE_SERVICE_HOSTS) {
      const url = `https://${host}/path`;
      expect(isLiveRequest({ url, userAgent: ZOTERO_UA })).toBe(true);
      expect(isLiveRequest({ url, userAgent: undefined })).toBe(true);
    }
  });

  it("is false for loopback, with the plugin's User-Agent and a port", () => {
    for (const host of ["127.0.0.1:9000", "localhost:9000", "[::1]:9000"]) {
      expect(
        isLiveRequest({ url: `http://${host}/x`, userAgent: PLUGIN_UA }),
      ).toBe(false);
    }
  });

  it("is false for Zotero's own requests", () => {
    for (const url of [
      "https://api.zotero.org/retractions/list",
      "https://www.zotero.org/download/",
      "https://example.invalid/attachment.pdf",
    ]) {
      expect(isLiveRequest({ url, userAgent: ZOTERO_UA })).toBe(false);
    }
  });

  it("compares a host whole", () => {
    expect(
      isLiveRequest({
        url: "https://api.crossref.org.example/x",
        userAgent: ZOTERO_UA,
      }),
    ).toBe(false);
  });
});
