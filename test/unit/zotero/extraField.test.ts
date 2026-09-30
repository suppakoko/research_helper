import { describe, expect, it } from "vitest";

import {
  applyExtraUpdate,
  EXTRA_GROWTH_CAP_CHARS,
  findExtraLine,
  isPluginKey,
  isPluginLine,
  parseExtra,
  readWorkKey,
  RH_PREFIX,
  RH_SOURCES_KEY,
  RH_WORK_KEY,
} from "../../../src/zotero/extraField";

/**
 * `P1-T12`, `src/zotero/extraField.ts`. Layer 1 (docs/13 §2.1): plain Node, no
 * Zotero, no network — the module takes no platform capability, which is the
 * whole reason the `extra` contract is testable at this layer.
 *
 * The assertions are `docs/07` §6.3's four rules, in order: parse to triples;
 * replace only `rh-` lines; preserve foreign lines byte-for-byte including
 * order; cap growth at ~500 characters and defer the rest to a child note.
 */

describe("parseExtra — §6.3's (key, value, lineIndex) triples", () => {
  it("returns no lines for an absent or empty field", () => {
    expect(parseExtra(undefined)).toEqual([]);
    expect(parseExtra(null)).toEqual([]);
    expect(parseExtra("")).toEqual([]);
  });

  it("parses key, value and index, and keeps the raw line", () => {
    const lines = parseExtra("Citation Key: smith2024\nPMID: 999");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toEqual({
      lineIndex: 0,
      raw: "Citation Key: smith2024",
      key: "Citation Key",
      value: "smith2024",
    });
    expect(lines[1]).toEqual({
      lineIndex: 1,
      raw: "PMID: 999",
      key: "PMID",
      value: "999",
    });
  });

  it("splits on the FIRST colon, so a URL value survives intact", () => {
    const line = parseExtra("rh-note: see https://doi.org/10.1234/abc")[0];
    expect(line?.key).toBe("rh-note");
    expect(line?.value).toBe("see https://doi.org/10.1234/abc");
  });

  it("gives a colon-less line no key, and keeps it as a line", () => {
    const lines = parseExtra("free text\n\nCitation Key: x");
    expect(lines.map((l) => l.key)).toEqual([
      undefined,
      undefined,
      "Citation Key",
    ]);
    expect(lines[0]?.raw).toBe("free text");
    expect(lines[1]?.raw).toBe("");
  });

  it("keeps a CRLF field's \\r in raw but out of the value", () => {
    const lines = parseExtra("Citation Key: smith2024\r\nPMID: 999");
    expect(lines[0]?.raw).toBe("Citation Key: smith2024\r");
    expect(lines[0]?.value).toBe("smith2024");
    // Re-joining raw with "\n" reproduces the original bytes.
    expect(lines.map((l) => l.raw).join("\n")).toBe(
      "Citation Key: smith2024\r\nPMID: 999",
    );
  });
});

describe("namespace helpers", () => {
  it("recognises the rh- prefix, case-insensitively", () => {
    expect(RH_PREFIX).toBe("rh-");
    expect(isPluginKey(RH_WORK_KEY)).toBe(true);
    expect(isPluginKey("RH-Work-Key")).toBe(true);
    expect(isPluginKey("PMID")).toBe(false);
  });

  it("treats the withdrawn research_helper- spellings as FOREIGN (conflict C1)", () => {
    // plan/02 §4 C1: both spellings "are gone". Meeting one in a real field
    // means somebody else's release wrote it; §6.3 says preserve, not migrate.
    const lines = parseExtra("research_helper-key: doi:10.1/a");
    expect(lines[0]).toBeDefined();
    expect(isPluginLine(lines[0]!)).toBe(false);
  });

  it("finds a line by key case-insensitively", () => {
    const lines = parseExtra("pmid: 999");
    expect(findExtraLine(lines, "PMID")?.value).toBe("999");
    expect(findExtraLine(lines, "DOI")).toBeUndefined();
  });

  it("reads rh-work-key back out", () => {
    expect(readWorkKey("x: y\nrh-work-key: doi:10.1/a")).toBe("doi:10.1/a");
    expect(readWorkKey("x: y")).toBeUndefined();
    expect(readWorkKey(undefined)).toBeUndefined();
  });
});

describe("applyExtraUpdate — writes", () => {
  it("appends plugin lines to an empty field", () => {
    const result = applyExtraUpdate(undefined, {
      pluginLines: [
        { key: RH_WORK_KEY, value: "doi:10.1234/abc" },
        { key: RH_SOURCES_KEY, value: "pubmed" },
      ],
      standardLines: [],
    });
    expect(result.extra).toBe(
      "rh-work-key: doi:10.1234/abc\nrh-sources: pubmed",
    );
    expect(result.overflowed).toBe(false);
    expect(result.deferred).toEqual([]);
  });

  /**
   * The card's third `Done when` criterion, verbatim: "Given an existing
   * `extra` of `\"Citation Key: smith2024\\nPMID: 999\"`, writing `rh-work-key`
   * leaves both original lines byte-identical and in order."
   */
  it("leaves foreign lines byte-identical and in order", () => {
    const existing = "Citation Key: smith2024\nPMID: 999";
    const result = applyExtraUpdate(existing, {
      pluginLines: [{ key: RH_WORK_KEY, value: "doi:10.1234/abc" }],
      standardLines: [],
    });
    const lines = result.extra.split("\n");
    expect(lines[0]).toBe("Citation Key: smith2024");
    expect(lines[1]).toBe("PMID: 999");
    expect(lines[2]).toBe("rh-work-key: doi:10.1234/abc");
    // Byte-for-byte: the original field is a literal prefix of the new one.
    expect(result.extra.startsWith(existing)).toBe(true);
  });

  it("replaces an existing rh- line IN PLACE, keeping its position", () => {
    const result = applyExtraUpdate(
      "rh-work-key: pmid:1\nCitation Key: smith2024\nrh-sources: pubmed",
      {
        pluginLines: [
          { key: RH_WORK_KEY, value: "doi:10.1234/abc" },
          { key: RH_SOURCES_KEY, value: "pubmed,crossref" },
        ],
        standardLines: [],
      },
    );
    expect(result.extra.split("\n")).toEqual([
      "rh-work-key: doi:10.1234/abc",
      "Citation Key: smith2024",
      "rh-sources: pubmed,crossref",
    ]);
  });

  it("matches an rh- key case-insensitively rather than duplicating it", () => {
    const result = applyExtraUpdate("RH-Work-Key: pmid:1", {
      pluginLines: [{ key: RH_WORK_KEY, value: "doi:10.1/a" }],
      standardLines: [],
    });
    expect(result.extra).toBe("rh-work-key: doi:10.1/a");
  });

  it("never rewrites a foreign line, even one that looks like ours", () => {
    const existing = "research_helper-key: doi:10.9/old\nrandom noise";
    const result = applyExtraUpdate(existing, {
      pluginLines: [{ key: RH_WORK_KEY, value: "doi:10.1/a" }],
      standardLines: [],
    });
    expect(result.extra).toBe(`${existing}\nrh-work-key: doi:10.1/a`);
  });

  it("writes a standard line only when no line with that key exists", () => {
    const withIt = applyExtraUpdate("PMID: 999", {
      pluginLines: [],
      standardLines: [{ key: "PMID", value: "12345678" }],
    });
    expect(withIt.extra).toBe("PMID: 999");
    expect(withIt.growthChars).toBe(0);

    const withoutIt = applyExtraUpdate("Citation Key: x", {
      pluginLines: [],
      standardLines: [{ key: "PMID", value: "12345678" }],
    });
    expect(withoutIt.extra).toBe("Citation Key: x\nPMID: 12345678");
  });

  it("does not duplicate a standard key requested twice in one write", () => {
    const result = applyExtraUpdate("", {
      pluginLines: [],
      standardLines: [
        { key: "arXiv", value: "2401.01234" },
        { key: "arXiv", value: "2401.09999" },
      ],
    });
    expect(result.extra).toBe("arXiv: 2401.01234");
  });

  it("renders an empty value as a bare key", () => {
    const result = applyExtraUpdate("", {
      pluginLines: [{ key: RH_WORK_KEY, value: "" }],
      standardLines: [],
    });
    expect(result.extra).toBe("rh-work-key:");
  });

  it("does not add a second blank line to a field that ends in one", () => {
    const result = applyExtraUpdate("Citation Key: x\n", {
      pluginLines: [{ key: RH_WORK_KEY, value: "pmid:1" }],
      standardLines: [],
    });
    expect(result.extra).toBe("Citation Key: x\nrh-work-key: pmid:1");
  });

  it("reports negative growth when a value shrinks", () => {
    const result = applyExtraUpdate("rh-sources: pubmed,crossref,europepmc", {
      pluginLines: [{ key: RH_SOURCES_KEY, value: "pubmed" }],
      standardLines: [],
    });
    expect(result.growthChars).toBeLessThan(0);
    expect(result.overflowed).toBe(false);
  });
});

describe("applyExtraUpdate — the ~500-character cap (§6.3)", () => {
  const long = (n: number): string => "x".repeat(n);

  it("does not trip at the cap", () => {
    // rh-work-key: + space = 13 characters of key overhead.
    const result = applyExtraUpdate("", {
      pluginLines: [
        { key: RH_WORK_KEY, value: long(EXTRA_GROWTH_CAP_CHARS - 13) },
      ],
      standardLines: [],
    });
    expect(result.growthChars).toBe(EXTRA_GROWTH_CAP_CHARS);
    expect(result.overflowed).toBe(false);
    expect(result.deferred).toEqual([]);
  });

  it("keeps only rh-work-key past the cap and defers the rest", () => {
    const result = applyExtraUpdate("Citation Key: smith2024", {
      pluginLines: [
        { key: RH_WORK_KEY, value: "doi:10.1234/abc" },
        { key: RH_SOURCES_KEY, value: "pubmed" },
        { key: "rh-issn", value: long(600) },
      ],
      standardLines: [{ key: "Citations", value: "12 (pubmed, 2026-09-30)" }],
    });

    expect(result.overflowed).toBe(true);
    expect(result.extra).toBe(
      "Citation Key: smith2024\nrh-work-key: doi:10.1234/abc",
    );
    expect(result.deferred.map((entry) => entry.key)).toEqual([
      RH_SOURCES_KEY,
      "rh-issn",
      "Citations",
    ]);
    // The foreign line survives the capped path too.
    expect(result.extra.startsWith("Citation Key: smith2024")).toBe(true);
    expect(result.growthChars).toBeLessThanOrEqual(EXTRA_GROWTH_CAP_CHARS);
  });
});
