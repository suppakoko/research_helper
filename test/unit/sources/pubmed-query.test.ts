import { describe, expect, it } from "vitest";

import { MAINTAINER_EMAIL, TOOL_NAME } from "../../../src/core/http/userAgent";
import {
  buildEsearchRequest,
  explainPubmedQuery,
  PUBMED_ESEARCH_BASE_URL,
  renderPubmedTerm,
} from "../../../src/sources/pubmed/query";
import { parseUserQuery } from "../../../src/sources/shared/queryParse";
import { recencyWindow } from "../../../src/sources/shared/recency";
import type { QueryNode, SourceQuery } from "../../../src/sources/types";

/**
 * `P1-T08` steps 2–5. Layer 1 (`docs/13` §2.1): plain Node, no Zotero, **no
 * network** — this card builds query strings and never issues one.
 *
 * The rows `docs/13` §2.1 requires of a query builder are all here: boolean
 * translation, parenthesis balancing, date-range rendering, URL encoding, and
 * key redaction in the recorded URL.
 */

/** §12.2's worked example, as the user types it. */
const EXAMPLE_INPUT =
  '("base editing" OR "prime editing") AND title:CRISPR NOT mouse';

/**
 * `docs/02` §12.2's PubMed block, copied verbatim minus the `term=` prefix.
 *
 * The card's first criterion is "renders to the `docs/02` §12.2 example term,
 * **modulo whitespace**", so the doc's line breaks and indentation are kept as
 * they are in the document and {@link squash} does the modulo.
 */
const DOCS_02_12_2_PUBMED_TERM = `(("base editing"[All Fields] OR "prime editing"[All Fields])
      AND CRISPR[Title]
      NOT mouse[All Fields])
      AND ("2024/01/01"[EDAT] : "2026/12/31"[EDAT])`;

/** Collapse every whitespace run to one space — the "modulo whitespace". */
function squash(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

/** A clock fixed to the date conflict C10 is worked against. */
const CLOCK_2026_09_09 = {
  now: () => new Date(2026, 8, 9, 12, 0, 0).getTime(),
};

/** The shipped 3-calendar-year window, never a hand-written literal. */
const WINDOW = recencyWindow(3, CLOCK_2026_09_09);

function query(input: string, dated = true): SourceQuery {
  return {
    terms: parseUserQuery(input),
    limit: 50,
    ...(dated && { fromDate: WINDOW.fromDate, toDate: WINDOW.toDate }),
  };
}

describe("renderPubmedTerm — docs/02 §12.2 translation", () => {
  it("renders §12.2's example term, modulo whitespace", () => {
    const rendered = explainPubmedQuery(query(EXAMPLE_INPUT));

    expect(squash(rendered)).toBe(squash(DOCS_02_12_2_PUBMED_TERM));
  });

  it("renders the Boolean half of that example without the date clause", () => {
    // What actually goes in `term=`: the window travels as mindate/maxdate.
    expect(renderPubmedTerm(parseUserQuery(EXAMPLE_INPUT))).toBe(
      '(("base editing"[All Fields] OR "prime editing"[All Fields])' +
        " AND CRISPR[Title] NOT mouse[All Fields])",
    );
  });

  it("uppercases every Boolean, whatever the user typed", () => {
    const rendered = renderPubmedTerm(parseUserQuery("a OR b AND c -d"));

    // §12.2: "Booleans must be uppercase" — PubMed silently treats a lowercase
    // `and` as a search term, so this is a wrong-results bug, not a 400.
    expect(rendered).toContain(" OR ");
    expect(rendered).toContain(" AND ");
    expect(rendered).toContain("NOT ");
    expect(rendered).not.toMatch(/\b(?:and|or|not)\b/u);
  });

  it("uses §12.2's field tags for every docs/07 §4.2 QueryField", () => {
    const tag = (field: QueryNode): string => renderPubmedTerm(field);

    expect(tag({ kind: "term", value: "x", field: "title" })).toBe("x[Title]");
    expect(tag({ kind: "term", value: "x", field: "abstract" })).toBe(
      "x[Title/Abstract]",
    );
    expect(tag({ kind: "term", value: "x", field: "titleOrAbstract" })).toBe(
      "x[Title/Abstract]",
    );
    expect(tag({ kind: "term", value: "x", field: "author" })).toBe(
      "x[Author]",
    );
    expect(tag({ kind: "term", value: "x", field: "journal" })).toBe(
      "x[Journal]",
    );
    expect(tag({ kind: "term", value: "x", field: "affiliation" })).toBe(
      "x[Affiliation]",
    );
    expect(tag({ kind: "term", value: "x", field: "meshTerm" })).toBe(
      "x[MeSH Terms]",
    );
    expect(tag({ kind: "term", value: "x", field: "any" })).toBe(
      "x[All Fields]",
    );
    // An unfielded term is `[All Fields]` too — the card's step 2.
    expect(tag({ kind: "term", value: "x" })).toBe("x[All Fields]");
  });

  it("quotes phrases and anything carrying non-word characters", () => {
    expect(
      renderPubmedTerm({ kind: "term", value: "base editing", phrase: true }),
    ).toBe('"base editing"[All Fields]');
    expect(renderPubmedTerm({ kind: "term", value: "CRISPR" })).toBe(
      "CRISPR[All Fields]",
    );
    expect(renderPubmedTerm({ kind: "term", value: "CRISPR-Cas9" })).toBe(
      "CRISPR-Cas9[All Fields]",
    );
    expect(renderPubmedTerm({ kind: "term", value: "a&b" })).toBe(
      '"a&b"[All Fields]',
    );
  });

  it("renders NOT as Entrez's binary NOT, never as AND NOT", () => {
    expect(renderPubmedTerm(parseUserQuery("CRISPR NOT mouse"))).toBe(
      "(CRISPR[All Fields] NOT mouse[All Fields])",
    );
    expect(renderPubmedTerm(parseUserQuery("CRISPR NOT mouse NOT rat"))).toBe(
      "(CRISPR[All Fields] NOT mouse[All Fields] NOT rat[All Fields])",
    );
  });

  it("renders a left-operand-less NOT honestly rather than inventing one", () => {
    // PubMed rejects this. Supplying an implicit `all[All Fields]` left operand
    // would instead run a multi-million-record query the user never asked for.
    expect(renderPubmedTerm(parseUserQuery("NOT mouse"))).toBe(
      "NOT mouse[All Fields]",
    );
  });

  it("strips Entrez syntax characters out of term text", () => {
    // The raw-string fallback puts arbitrary user text in a term value, so the
    // characters that *are* the syntax cannot survive inside one.
    expect(
      renderPubmedTerm({ kind: "term", value: '(a) "b" [c]', field: "any" }),
    ).toBe('"a b c"[All Fields]');
  });

  it("renders nothing for a tree with nothing renderable in it", () => {
    expect(renderPubmedTerm({ kind: "and", children: [] })).toBe("");
    expect(renderPubmedTerm({ kind: "or", children: [] })).toBe("");
    expect(renderPubmedTerm({ kind: "term", value: "()" })).toBe("");
    expect(
      renderPubmedTerm({
        kind: "not",
        child: { kind: "term", value: "[]" },
      }),
    ).toBe("");
    expect(
      renderPubmedTerm({
        kind: "and",
        children: [
          { kind: "term", value: "()" },
          { kind: "term", value: "CRISPR" },
        ],
      }),
    ).toBe("CRISPR[All Fields]");
  });
});

// ---------------------------------------------------------------------------
// Parenthesis balancing — the card's second criterion
// ---------------------------------------------------------------------------

/** Deterministic PRNG (mulberry32): a seeded property test, never a flaky one. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Parentheses are balanced and never close before they open. */
function parensBalanced(rendered: string): boolean {
  let depth = 0;
  for (const ch of rendered) {
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth < 0) return false;
    }
  }
  return depth === 0;
}

describe("renderPubmedTerm — parenthesis balancing", () => {
  it("balances parentheses across 100 generated inputs", () => {
    const pieces = [
      "(",
      ")",
      '"',
      "AND",
      "OR",
      "NOT",
      "-",
      "and",
      "CRISPR",
      "base editing",
      "title:",
      "abstract:CRISPR",
      "author:",
      "journal:Nature",
      "CRISPR-Cas9",
      "a&b+c#d",
      "유전자편집",
      ":",
      "[",
      "]",
      "",
      "   ",
    ];
    const random = mulberry32(0x50317430);
    const offenders: string[] = [];

    for (let i = 0; i < 100; i += 1) {
      const length = 1 + Math.floor(random() * 8);
      let input = "";
      for (let j = 0; j < length; j += 1) {
        const piece = pieces[Math.floor(random() * pieces.length)] ?? "";
        input += `${piece} `;
      }
      const rendered = renderPubmedTerm(parseUserQuery(input));
      if (!parensBalanced(rendered)) offenders.push(`${input}=> ${rendered}`);
    }

    expect(offenders).toEqual([]);
  });

  it("balances the hand-picked pathological cases too", () => {
    for (const input of [
      "(((",
      ")))",
      '(a OR "b',
      "()()",
      "-(",
      "title:(",
      `${"(".repeat(40)}a`,
      "(a OR b) AND (c OR (d AND e))",
    ]) {
      expect(parensBalanced(renderPubmedTerm(parseUserQuery(input)))).toBe(
        true,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// The esearch parameter set — the card's steps 3 and 5
// ---------------------------------------------------------------------------

describe("buildEsearchRequest — parameters", () => {
  it("emits the parameters in a fixed, fixture-hashable order", () => {
    const request = buildEsearchRequest({
      query: query(EXAMPLE_INPUT),
      retmax: 100,
      retstart: 0,
    });

    expect(request.queryString.split("&").map((p) => p.split("=")[0])).toEqual([
      "db",
      "term",
      "retmode",
      "retmax",
      "retstart",
      "datetype",
      "mindate",
      "maxdate",
      "tool",
      "email",
    ]);
    expect(request.url).toBe(
      `${PUBMED_ESEARCH_BASE_URL}?${request.queryString}`,
    );
    expect(request.endpointBaseUrl).toBe(PUBMED_ESEARCH_BASE_URL);
    // Byte-stable for a given input: `docs/13` §2.2 keys fixtures on the URL.
    expect(
      buildEsearchRequest({
        query: query(EXAMPLE_INPUT),
        retmax: 100,
        retstart: 0,
      }).url,
    ).toBe(request.url);
  });

  it("carries the D10 identification parameters on every request", () => {
    const params = new URLSearchParams(
      buildEsearchRequest({ query: query("CRISPR"), retmax: 20 }).queryString,
    );

    expect(params.get("tool")).toBe(TOOL_NAME);
    expect(params.get("tool")).toBe("research_helper");
    expect(params.get("email")).toBe(MAINTAINER_EMAIL);
  });

  it("renders the window as mindate/maxdate with datetype=edat", () => {
    const params = new URLSearchParams(
      buildEsearchRequest({ query: query(EXAMPLE_INPUT), retmax: 100 })
        .queryString,
    );

    // docs/02 §3.3 mechanism (b), `YYYY/MM/DD`, with §3.3's default datetype.
    expect(params.get("datetype")).toBe("edat");
    expect(params.get("mindate")).toBe("2024/01/01");
    expect(params.get("maxdate")).toBe("2026/12/31");
    expect(params.get("db")).toBe("pubmed");
    expect(params.get("retmax")).toBe("100");
    expect(params.get("retstart")).toBe("0");
    expect(params.get("retmode")).toBe("json");
  });

  it("never emits reldate — the window is calendar years, not rolling days", () => {
    // Conflict C10, closed in favour of docs/08 §4.2's calendar-year span.
    // docs/02 §3.3(a)'s `reldate=1095` is a rolling-days mechanism and would
    // make §4.2's `2024 – 2026` label lie.
    const request = buildEsearchRequest({
      query: query(EXAMPLE_INPUT),
      retmax: 100,
    });

    expect(request.url).not.toContain("reldate");
    expect(request.url).not.toContain("1095");
    expect(explainPubmedQuery(query(EXAMPLE_INPUT))).not.toContain("1095");
  });

  it("does not default to pdat, but exposes it as the advanced option", () => {
    // §3.3 observed live: a `pdat` for an ahead-of-print record can be a
    // future cover date, so `edat` is the default.
    const advanced = new URLSearchParams(
      buildEsearchRequest({
        query: query(EXAMPLE_INPUT),
        retmax: 10,
        datetype: "pdat",
      }).queryString,
    );

    expect(advanced.get("datetype")).toBe("pdat");
    expect(squash(explainPubmedQuery(query(EXAMPLE_INPUT), "pdat"))).toContain(
      '("2024/01/01"[PDAT] : "2026/12/31"[PDAT])',
    );
  });

  it("omits every date parameter when the user chose all years", () => {
    // FR-3's "All years": no date restriction reaches any source query.
    const request = buildEsearchRequest({
      query: query("CRISPR", false),
      retmax: 10,
    });

    expect(request.queryString).not.toContain("mindate");
    expect(request.queryString).not.toContain("maxdate");
    expect(request.queryString).not.toContain("datetype");
    expect(explainPubmedQuery(query("CRISPR", false))).toBe(
      "CRISPR[All Fields]",
    );
  });

  it("refuses a half-open window rather than inventing the other bound", () => {
    // docs/02 §3.3: mindate and maxdate are "both required together".
    expect(() =>
      buildEsearchRequest({
        query: {
          terms: parseUserQuery("CRISPR"),
          limit: 10,
          fromDate: WINDOW.fromDate,
        },
        retmax: 10,
      }),
    ).toThrow(/both date bounds or neither/u);
    expect(() =>
      buildEsearchRequest({
        query: {
          terms: parseUserQuery("CRISPR"),
          limit: 10,
          toDate: WINDOW.toDate,
        },
        retmax: 10,
      }),
    ).toThrow(/both date bounds or neither/u);
  });

  it("accepts the coarser bounds §3.3 allows and rejects nonsense", () => {
    const coarse = new URLSearchParams(
      buildEsearchRequest({
        query: {
          terms: parseUserQuery("CRISPR"),
          limit: 10,
          fromDate: "2024",
          toDate: "2026-12",
        },
        retmax: 10,
      }).queryString,
    );

    expect(coarse.get("mindate")).toBe("2024");
    expect(coarse.get("maxdate")).toBe("2026/12");
    expect(() =>
      buildEsearchRequest({
        query: {
          terms: parseUserQuery("CRISPR"),
          limit: 10,
          fromDate: "last tuesday",
          toDate: "2026-12-31",
        },
        retmax: 10,
      }),
    ).toThrow(/YYYY-MM-DD/u);
  });
});

// ---------------------------------------------------------------------------
// URL encoding and key redaction
// ---------------------------------------------------------------------------

describe("buildEsearchRequest — URL encoding", () => {
  it("round-trips `&`, `+`, `#` and a Korean phrase unchanged", () => {
    const source = query('a&b+c#d AND "유전자 편집"');
    const expected = renderPubmedTerm(source.terms);
    const request = buildEsearchRequest({ query: source, retmax: 10 });

    expect(expected).toBe(
      '("a&b+c#d"[All Fields] AND "유전자 편집"[All Fields])',
    );
    // Decoded from the raw pair, and again through URLSearchParams — the second
    // catches a `+`-for-space encoding, which would silently become a space.
    const pair = request.queryString
      .split("&")
      .find((p) => p.startsWith("term="));
    expect(decodeURIComponent((pair ?? "").slice("term=".length))).toBe(
      expected,
    );
    expect(new URLSearchParams(request.queryString).get("term")).toBe(expected);
    // The raw separators must not survive unencoded into the query string.
    expect(request.queryString).toContain("%26");
    expect(request.queryString).toContain("%2B");
    expect(request.queryString).toContain("%23");
  });

  it("round-trips every parameter through a real URL parse", () => {
    const source = query(EXAMPLE_INPUT);
    const request = buildEsearchRequest({
      query: source,
      retmax: 100,
      retstart: 9998,
    });
    const parsed = new URL(request.url);

    expect(parsed.searchParams.get("term")).toBe(
      renderPubmedTerm(source.terms),
    );
    expect(parsed.searchParams.get("retstart")).toBe("9998");
  });
});

describe("buildEsearchRequest — key redaction", () => {
  const API_KEY = "0123456789abcdef0123456789abcdef";

  it("sends api_key but redacts it out of the recorded URL", () => {
    const request = buildEsearchRequest({
      query: query(EXAMPLE_INPUT),
      retmax: 100,
      apiKey: API_KEY,
    });

    // What goes on the wire carries the key.
    expect(request.url).toContain(`api_key=${API_KEY}`);
    expect(request.queryString).toContain(`api_key=${API_KEY}`);

    // What is stored in `SourceProvenance` (docs/07 §5.3, NFR-16) does not.
    expect(request.transmittedUrl).not.toContain(API_KEY);
    expect(request.transmittedUrl).not.toContain("api_key");
    expect(request.transmittedQuery).not.toContain(API_KEY);
    expect(request.transmittedQuery).not.toContain("api_key");

    // Still a usable record of the request: endpoint and term survive.
    expect(request.transmittedUrl.startsWith(PUBMED_ESEARCH_BASE_URL)).toBe(
      true,
    );
    expect(new URL(request.transmittedUrl).searchParams.get("tool")).toBe(
      TOOL_NAME,
    );
    expect(request.transmittedQuery).toBe(
      request.transmittedUrl.slice(request.transmittedUrl.indexOf("?") + 1),
    );
  });

  it("omits api_key entirely when no key is configured", () => {
    const request = buildEsearchRequest({ query: query("CRISPR"), retmax: 10 });

    expect(request.queryString).not.toContain("api_key");
    expect(request.transmittedUrl).toBe(request.url);
  });
});
