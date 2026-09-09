import { describe, expect, it } from "vitest";

import { normalizeDoi } from "../../../src/model/ids";
import { FakeZotero } from "../../setup/zotero-global";

/**
 * Layer 1 (docs/13 §2.1): plain Node, no Zotero, no network.
 *
 * `vitest` globals are deliberately not used — every symbol is imported. That
 * keeps `tsconfig.json`'s `types` array as `P0-T05` resolved it
 * (`["zotero-types/entries/sandbox", "node"]`) instead of adding
 * `"vitest/globals"` to it.
 */

describe("the unit-test environment", () => {
  it("installs the docs/13 §2.1 Zotero fake as the global", () => {
    // Proof that `vitest.config.ts`'s `test.setupFiles` ran: the global exists
    // and is the fake, not a real Zotero. Read through `globalThis` rather than
    // as a bare identifier so the spec does not itself name the global that
    // docs/07 §2.3 confines to `src/zotero/`.
    const installed = (globalThis as { Zotero?: unknown }).Zotero;
    expect(installed).toBe(FakeZotero);
  });
});

describe("normalizeDoi", () => {
  it("passes through an already-normal DOI", () => {
    expect(normalizeDoi("10.1056/nejmoa2300709")).toBe("10.1056/nejmoa2300709");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeDoi("  10.1056/nejmoa2300709\n")).toBe(
      "10.1056/nejmoa2300709",
    );
  });

  // docs/02 §11.1: Semantic Scholar returns an uppercase suffix that would not
  // match Crossref's lowercase spelling of the same DOI without this.
  it("lowercases an uppercase suffix", () => {
    expect(normalizeDoi("10.18653/V1/2020.ACL-MAIN.447")).toBe(
      "10.18653/v1/2020.acl-main.447",
    );
  });

  // docs/02 §11.1: OpenAlex sends full resolver URLs.
  it("strips a https://doi.org/ resolver prefix", () => {
    expect(normalizeDoi("https://doi.org/10.1056/NEJMoa2300709")).toBe(
      "10.1056/nejmoa2300709",
    );
  });

  it("strips http:// and dx.doi.org resolver prefixes", () => {
    expect(normalizeDoi("http://dx.doi.org/10.1056/nejmoa2300709")).toBe(
      "10.1056/nejmoa2300709",
    );
  });

  it("strips the doi: and info:doi/ schemes", () => {
    expect(normalizeDoi("doi: 10.1056/nejmoa2300709")).toBe(
      "10.1056/nejmoa2300709",
    );
    expect(normalizeDoi("info:doi/10.1056/nejmoa2300709")).toBe(
      "10.1056/nejmoa2300709",
    );
  });

  it("strips angle brackets and quotes seen in deposits", () => {
    expect(normalizeDoi("<10.1056/nejmoa2300709>")).toBe(
      "10.1056/nejmoa2300709",
    );
    expect(normalizeDoi('"10.1056/nejmoa2300709"')).toBe(
      "10.1056/nejmoa2300709",
    );
  });

  it("strips trailing punctuation left by text extraction", () => {
    expect(normalizeDoi("10.1056/nejmoa2300709.")).toBe(
      "10.1056/nejmoa2300709",
    );
    expect(normalizeDoi("10.1056/nejmoa2300709);")).toBe(
      "10.1056/nejmoa2300709",
    );
  });

  it("percent-decodes an over-encoded suffix once", () => {
    expect(normalizeDoi("10.1234/abc%2Fdef")).toBe("10.1234/abc/def");
  });

  it("keeps a malformed percent-escape as-is rather than throwing", () => {
    // decodeURIComponent throws on "%zz"-style input; §11.1's catch swallows it,
    // and the survivor still has to pass the syntax test.
    expect(normalizeDoi("10.1234/abc%e0%a4%a")).toBe("10.1234/abc%e0%a4%a");
  });

  it.each([
    ["not a doi", "no 10.-prefix at all"],
    ["", "empty string"],
    ["10.1234", "registrant only, no suffix"],
    ["10.123/foo", "registrant shorter than four digits"],
    ["10.1234567890/foo", "registrant longer than nine digits"],
    ["10.1234/", "empty suffix"],
    ["10.1234/foo bar", "whitespace inside the suffix"],
    ["https://example.org/paper", "a URL that is not a DOI"],
  ])("rejects %j (%s)", (input) => {
    expect(normalizeDoi(input)).toBeNull();
  });

  it("returns null for null and undefined", () => {
    expect(normalizeDoi(null)).toBeNull();
    expect(normalizeDoi(undefined)).toBeNull();
  });
});
