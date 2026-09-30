import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  buildWorkKey,
  isSourceId,
  normalizeDoi,
  normalizePmcid,
  normalizePmid,
  sha1Hex,
  SOURCE_IDS,
  type ArxivId,
  type Doi,
  type ExternalIds,
  type S2CorpusId,
} from "../../../src/model/ids";

/**
 * `P1-T01`. Layer 1 (docs/13 §2.1): plain Node, no Zotero, no network.
 *
 * `vitest` globals are deliberately not used — every symbol is imported, which
 * keeps `tsconfig.json`'s `types` array as `P0-T05` resolved it.
 *
 * `test/unit/model/ids.spec.ts` is the `P0-T12` spike's test for the spike's
 * single function and still passes against the shipped module. Its
 * `normalizeDoi` cases overlap with the ones below, which `P1-T01` step 6
 * requires here; the spike file is not in this card's `Files` list, so it is
 * left alone rather than folded in.
 */

/** Build a branded {@link Doi} from a spelling that must normalize. */
function doi(raw: string): Doi {
  const value = normalizeDoi(raw);
  if (value === null) throw new Error(`test fixture is not a DOI: ${raw}`);
  return value;
}

describe("normalizeDoi", () => {
  // The three real cases docs/02 §11.1 names, all observed in this project's
  // live probes. Each is the reason one line of the implementation exists.
  describe("the three real upstream cases of docs/02 §11.1", () => {
    it("strips OpenAlex's resolver prefix", () => {
      expect(normalizeDoi("https://doi.org/10.1056/nejmoa2300709")).toBe(
        "10.1056/nejmoa2300709",
      );
    });

    it("lowercases Semantic Scholar's uppercase suffix", () => {
      // Without this, S2's spelling matches neither Crossref's
      // 10.18653/v1/2020.acl-main.447 nor any third source.
      expect(normalizeDoi("10.18653/V1/2020.ACL-MAIN.447")).toBe(
        "10.18653/v1/2020.acl-main.447",
      );
    });

    it("passes through Crossref's DOI once the JSON parser has unescaped it", () => {
      // §11.1: `"10.3791\/20970"` is a JSON-escaped slash, handled by the JSON
      // parser and not by this function, so what arrives here is already bare.
      expect(normalizeDoi("10.3791/20970")).toBe("10.3791/20970");
    });
  });

  // P1-T01's first "Done when" criterion, verbatim.
  it("normalizes the mixed-case resolver URL of the acceptance criterion", () => {
    expect(normalizeDoi("https://doi.org/10.1056/NEJMoa2300709")).toBe(
      "10.1056/nejmoa2300709",
    );
  });

  it("returns null for an unparseable input", () => {
    expect(normalizeDoi("not a doi")).toBeNull();
  });

  describe("every remaining branch of docs/02 §11.1's body", () => {
    it("trims surrounding whitespace", () => {
      expect(normalizeDoi("  10.1056/nejmoa2300709\n")).toBe(
        "10.1056/nejmoa2300709",
      );
    });

    it("strips the http:// and dx.doi.org resolver forms", () => {
      expect(normalizeDoi("http://dx.doi.org/10.1056/NEJMoa2300709")).toBe(
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

    it("keeps a malformed percent-escape rather than throwing", () => {
      // decodeURIComponent throws on a truncated escape; §11.1's catch
      // swallows it and the survivor still has to pass the syntax test.
      expect(normalizeDoi("10.1234/abc%e0%a4%a")).toBe("10.1234/abc%e0%a4%a");
    });

    it.each([
      ["", "empty string"],
      ["10.1234", "registrant only, no suffix"],
      ["10.123/foo", "registrant shorter than four digits"],
      ["10.1234567890/foo", "registrant longer than nine digits"],
      ["10.1234/", "empty suffix"],
      ["10.1234/foo bar", "whitespace inside the suffix"],
      ["https://example.org/paper", "a URL that is not a DOI"],
      ["11.1234/foo", "a directory indicator other than 10"],
    ])("rejects %j (%s)", (input) => {
      expect(normalizeDoi(input)).toBeNull();
    });

    it("returns null for null and undefined", () => {
      expect(normalizeDoi(null)).toBeNull();
      expect(normalizeDoi(undefined)).toBeNull();
    });

    // `P0-T12`'s Findings asked P1-T01 to decide this, and the decision is "as
    // specified": docs/02 §11.1's strip `[.,;)\]]+$` has no leading
    // counterpart, so a DOI lifted from parenthesized prose loses its closing
    // paren, keeps its opening one, and then fails the `^10\.` anchor. That is
    // §11.1's behaviour, not a bug this card is chartered to fix; widening the
    // regex would change a reference implementation three other cards read.
    // It is asserted here so the behaviour is visible rather than latent.
    it("drops a DOI still wrapped in prose parentheses (docs/02 §11.1 as specified)", () => {
      expect(normalizeDoi("(10.1056/nejmoa2300709);")).toBeNull();
      expect(normalizeDoi("[10.1056/nejmoa2300709]")).toBeNull();
    });
  });
});

describe("normalizePmid", () => {
  it("passes a bare PMID through unchanged", () => {
    expect(normalizePmid("32020029")).toBe("32020029");
  });

  it("trims whitespace", () => {
    expect(normalizePmid("  32020029 \n")).toBe("32020029");
  });

  it("strips the labelled form docs/07 §6.3 writes into Zotero's extra", () => {
    expect(normalizePmid("PMID: 32020029")).toBe("32020029");
    expect(normalizePmid("pmid:32020029")).toBe("32020029");
  });

  it.each([
    ["PMC7605294", "a PMCID"],
    ["10.1056/nejmoa2300709", "a DOI"],
    ["32020029a", "trailing non-digits"],
    ["3202 0029", "an internal space"],
    ["", "empty string"],
    ["-32020029", "a sign"],
  ])("rejects %j (%s)", (input) => {
    expect(normalizePmid(input)).toBeNull();
  });

  it("returns null for null and undefined", () => {
    expect(normalizePmid(null)).toBeNull();
    expect(normalizePmid(undefined)).toBeNull();
  });
});

describe("normalizePmcid", () => {
  // P1-T01's second "Done when" criterion, verbatim: docs/02 §10.2's Semantic
  // Scholar row supplies externalIds.PubMedCentral bare and says "add PMC".
  it("adds the PMC prefix when the source omitted it", () => {
    expect(normalizePmcid("7605294")).toBe("PMC7605294");
  });

  it("passes the already-prefixed Europe PMC form through", () => {
    expect(normalizePmcid("PMC7605294")).toBe("PMC7605294");
  });

  it("uppercases a lowercase prefix", () => {
    expect(normalizePmcid("pmc7605294")).toBe("PMC7605294");
  });

  it("strips the labelled extra-field form", () => {
    expect(normalizePmcid("PMCID: PMC7605294")).toBe("PMC7605294");
    expect(normalizePmcid(" pmcid:7605294 ")).toBe("PMC7605294");
  });

  it.each([
    ["10.1056/nejmoa2300709", "a DOI"],
    ["PMC", "the prefix alone"],
    ["PMC76052a4", "non-digits after the prefix"],
    ["", "empty string"],
  ])("rejects %j (%s)", (input) => {
    expect(normalizePmcid(input)).toBeNull();
  });

  it("returns null for null and undefined", () => {
    expect(normalizePmcid(null)).toBeNull();
    expect(normalizePmcid(undefined)).toBeNull();
  });
});

describe("buildWorkKey", () => {
  const DOI = doi("10.1056/nejmoa2300709");
  const PMID = normalizePmid("32020029");
  const PMCID = normalizePmcid("7605294");
  const ARXIV = "2401.01234" as ArxivId;
  const S2 = "214123456" as S2CorpusId;

  if (PMID === null || PMCID === null) {
    throw new Error("test fixtures must normalize");
  }

  const everything: ExternalIds = {
    doi: DOI,
    pmid: PMID,
    arxivId: ARXIV,
    s2CorpusId: S2,
  };

  // P1-T01's third "Done when" criterion: the §5.1 precedence order, asserted
  // arm by arm by removing the winner and re-running.
  it("prefers DOI over everything else", () => {
    expect(buildWorkKey(everything, "Title", 2024, "Kim")).toBe(
      "doi:10.1056/nejmoa2300709",
    );
  });

  it("prefers PMID once the DOI is gone", () => {
    const noDoi: ExternalIds = { pmid: PMID, arxivId: ARXIV, s2CorpusId: S2 };
    expect(buildWorkKey(noDoi, "Title", 2024, "Kim")).toBe("pmid:32020029");
  });

  it("prefers the arXiv id once DOI and PMID are gone", () => {
    expect(buildWorkKey({ arxivId: ARXIV, s2CorpusId: S2 }, "Title")).toBe(
      "arxiv:2401.01234",
    );
  });

  it("prefers the S2 corpus id once the first three are gone", () => {
    expect(buildWorkKey({ s2CorpusId: S2 }, "Title")).toBe("s2:214123456");
  });

  it("falls back to the title hash when no identifier is present", () => {
    expect(buildWorkKey({}, "A Title", 2024, "Kim")).toBe(
      `hash:${sha1Hex("A Title|2024|Kim")}`,
    );
  });

  it("prefers DOI over the title hash even when the title differs", () => {
    // The criterion "prefers DOI over PMID over the title hash" stated as one
    // assertion: two works with the same DOI and different titles share a key.
    expect(buildWorkKey({ doi: DOI }, "One title", 2024, "Kim")).toBe(
      buildWorkKey({ doi: DOI }, "A quite different title", 1999, "Park"),
    );
  });

  it("ignores ids.url and ids.pmcid, which §5.1 gives no arm", () => {
    const key = buildWorkKey(
      { pmcid: PMCID, url: "https://x.test/" },
      "A Title",
      2024,
      "Kim",
    );
    expect(key).toBe(`hash:${sha1Hex("A Title|2024|Kim")}`);
  });

  it("treats a missing year or author as an empty hash component", () => {
    expect(buildWorkKey({}, "A Title")).toBe(`hash:${sha1Hex("A Title||")}`);
    expect(buildWorkKey({}, "A Title", 2024)).toBe(
      `hash:${sha1Hex("A Title|2024|")}`,
    );
  });

  it("always returns a non-empty key", () => {
    expect(buildWorkKey({}, "").length).toBeGreaterThan(0);
  });
});

describe("sha1Hex", () => {
  // The published FIPS 180-4 / RFC 3174 vectors, so the hash arm of
  // buildWorkKey is asserted against an external reference and not itself.
  it.each([
    ["", "da39a3ee5e6b4b0d3255bfef95601890afd80709"],
    ["abc", "a9993e364706816aba3e25717850c26c9cd0d89d"],
    [
      "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
      "84983e441c3bd26ebaae4aa1f95129e5e54670f1",
    ],
  ])("hashes %j to the published vector", (input, expected) => {
    expect(sha1Hex(input)).toBe(expected);
  });

  it("agrees with node:crypto on ASCII, Korean, emoji and multi-block input", () => {
    // Cross-check rather than a second implementation of the same algorithm:
    // node:crypto is available to tests (Vitest runs in Node) but not to
    // `model/`, which docs/07 §2.3 keeps free of platform APIs.
    const cases = [
      "A Title|2024|Kim",
      // Two-byte (U+0080–U+07FF), three-byte and four-byte UTF-8 in turn, so
      // every arm of the hand-written encoder is checked against Node's.
      "Café au lait|2024|Lévy",
      "결핵 진단의 최신 동향|2025|박",
      "A title with an emoji 🧬|2024|Lee",
      "a".repeat(1000),
      "x".repeat(55),
      "x".repeat(56),
      "x".repeat(64),
      "x".repeat(119),
      "x".repeat(120),
    ];
    for (const input of cases) {
      expect(sha1Hex(input)).toBe(
        createHash("sha1").update(input, "utf8").digest("hex"),
      );
    }
  });

  it("returns 40 lowercase hex characters", () => {
    expect(sha1Hex("A Title|2024|Kim")).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe("SOURCE_IDS / isSourceId", () => {
  it("lists exactly the eight members of docs/07 §5.1's SourceId union", () => {
    expect(SOURCE_IDS).toEqual([
      "pubmed",
      "europepmc",
      "crossref",
      "semanticscholar",
      "arxiv",
      "biorxiv",
      "medrxiv",
      "openalex",
    ]);
  });

  it("accepts every member, including the reserved openalex", () => {
    for (const id of SOURCE_IDS) expect(isSourceId(id)).toBe(true);
  });

  it.each([["pubmedcentral"], ["PubMed"], [""], ["toString"]])(
    "rejects %j",
    (value) => {
      expect(isSourceId(value)).toBe(false);
    },
  );

  it("rejects non-strings", () => {
    expect(isSourceId(undefined)).toBe(false);
    expect(isSourceId(0)).toBe(false);
  });
});
