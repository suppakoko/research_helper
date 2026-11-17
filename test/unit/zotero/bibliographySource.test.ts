/**
 * `P7-T35` — which bibliography entries came from Semantic Scholar, for the
 * attribution line under the report's references (owner, 2026-11-17,
 * `plan/00` §6 item 395(c); `docs/09` §7). The pure reader of an item's
 * `extra` field; `test/integration/zotero/bibliography.spec.ts` checks the
 * flag on entries Zotero formats.
 */

import { describe, expect, it } from "vitest";

import { recordFromSemanticScholar } from "../../../src/zotero/bibliography";
import {
  RH_S2_CORPUS_ID_KEY,
  RH_SOURCES_KEY,
} from "../../../src/zotero/extraField";

describe("recordFromSemanticScholar (P7-T35, item 395(c))", () => {
  it("reads the rh-sources line the plugin writes", () => {
    expect(RH_SOURCES_KEY).toBe("rh-sources");
    expect(
      recordFromSemanticScholar(
        "rh-work-key: w1\nrh-sources: europepmc,semanticscholar",
      ),
    ).toBe(true);
    expect(recordFromSemanticScholar("rh-sources: semanticscholar")).toBe(true);
    expect(
      recordFromSemanticScholar("rh-sources: openalex, semanticscholar "),
    ).toBe(true);
    expect(recordFromSemanticScholar("RH-Sources: semanticscholar")).toBe(true);
  });

  it("reads the corpus id line, which only a Semantic Scholar record supplies", () => {
    expect(RH_S2_CORPUS_ID_KEY).toBe("rh-s2-corpus-id");
    expect(recordFromSemanticScholar("rh-s2-corpus-id: 12345")).toBe(true);
    expect(
      recordFromSemanticScholar("rh-sources: openalex\r\nrh-s2-corpus-id: 9"),
    ).toBe(true);
  });

  it("does not mark any other record", () => {
    expect(recordFromSemanticScholar("rh-sources: openalex,crossref")).toBe(
      false,
    );
    expect(recordFromSemanticScholar("rh-sources: semanticscholarx")).toBe(
      false,
    );
    expect(recordFromSemanticScholar("rh-sources:")).toBe(false);
    // Only the plugin's own line counts, not a word in someone else's.
    expect(recordFromSemanticScholar("note: semanticscholar")).toBe(false);
    expect(recordFromSemanticScholar("semanticscholar")).toBe(false);
    expect(recordFromSemanticScholar("")).toBe(false);
    expect(recordFromSemanticScholar(undefined)).toBe(false);
    expect(recordFromSemanticScholar(null)).toBe(false);
    expect(recordFromSemanticScholar(42)).toBe(false);
    // Only a string field is read, whatever a value prints as.
    expect(
      recordFromSemanticScholar({ toString: () => "rh-s2-corpus-id: 1" }),
    ).toBe(false);
  });
});
