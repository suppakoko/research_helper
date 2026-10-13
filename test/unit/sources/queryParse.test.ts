import { describe, expect, it } from "vitest";

import {
  normalizeForSource,
  parseUserQuery,
} from "../../../src/sources/shared/queryParse";
import {
  parseUserQuery as parseUserQueryViaTypes,
  type QueryField,
  type QueryNode,
  type SourceQuery,
} from "../../../src/sources/types";

/**
 * `P1-T08` step 1, extended by `P2-T01` (the nine `docs/02` §12.3 concept rows,
 * the exact malformed input its criterion 2 names, and `normalizeForSource`).
 * Layer 1 (`docs/13` §2.1): plain Node, no Zotero, no network.
 *
 * Asserted against `docs/02` §12.1's accepted syntax — quotes, `AND`/`OR`/`NOT`,
 * `-`, parentheses, the four `field:` prefixes, bare words defaulting to AND,
 * and the rule that matters most: **anything unparseable becomes one `term`
 * node and never a syntax error.**
 */

/** The query `docs/02` §12.2 works end to end. */
const EXAMPLE =
  '("base editing" OR "prime editing") AND title:CRISPR NOT mouse';

describe("parseUserQuery — docs/02 §12.1 syntax", () => {
  it("parses §12.2's worked example into the tree §12.2 renders", () => {
    expect(parseUserQuery(EXAMPLE)).toEqual<QueryNode>({
      kind: "and",
      children: [
        {
          kind: "or",
          children: [
            { kind: "term", value: "base editing", phrase: true },
            { kind: "term", value: "prime editing", phrase: true },
          ],
        },
        { kind: "term", value: "CRISPR", field: "title" },
        { kind: "not", child: { kind: "term", value: "mouse" } },
      ],
    });
  });

  it("defaults bare space-separated words to AND", () => {
    expect(parseUserQuery("CRISPR base editing")).toEqual<QueryNode>({
      kind: "and",
      children: [
        { kind: "term", value: "CRISPR" },
        { kind: "term", value: "base" },
        { kind: "term", value: "editing" },
      ],
    });
  });

  it("keeps a single term as a bare term node, not a one-child group", () => {
    expect(parseUserQuery("CRISPR")).toEqual<QueryNode>({
      kind: "term",
      value: "CRISPR",
    });
  });

  it("treats `-` as NOT", () => {
    expect(parseUserQuery("CRISPR -mouse")).toEqual<QueryNode>({
      kind: "and",
      children: [
        { kind: "term", value: "CRISPR" },
        { kind: "not", child: { kind: "term", value: "mouse" } },
      ],
    });
  });

  it("does not negate a hyphen inside a term", () => {
    // The hyphenated-gene-name case. `docs/02` §12.2's hyphen warning is
    // Semantic Scholar's alone; PubMed handles `CRISPR-Cas9` fine.
    expect(parseUserQuery("CRISPR-Cas9")).toEqual<QueryNode>({
      kind: "term",
      value: "CRISPR-Cas9",
    });
  });

  it("maps all four §12.1 field prefixes onto docs/07 §4.2 members", () => {
    expect(
      parseUserQuery("title:a abstract:b author:c journal:d"),
    ).toEqual<QueryNode>({
      kind: "and",
      children: [
        { kind: "term", value: "a", field: "title" },
        { kind: "term", value: "b", field: "abstract" },
        { kind: "term", value: "c", field: "author" },
        { kind: "term", value: "d", field: "journal" },
      ],
    });
  });

  it("accepts a field prefix on a quoted phrase and across a space", () => {
    expect(parseUserQuery('title:"prime editing"')).toEqual<QueryNode>({
      kind: "term",
      value: "prime editing",
      field: "title",
      phrase: true,
    });
    expect(parseUserQuery("author: Doe")).toEqual<QueryNode>({
      kind: "term",
      value: "Doe",
      field: "author",
    });
  });

  it("is case-insensitive about the prefix but not about the Booleans", () => {
    expect(parseUserQuery("TITLE:CRISPR")).toEqual<QueryNode>({
      kind: "term",
      value: "CRISPR",
      field: "title",
    });
    // Lowercase `and` is a word, which is PubMed's own rule (§12.2) and keeps
    // "patients not receiving therapy" from becoming a negation.
    expect(parseUserQuery("a and b")).toEqual<QueryNode>({
      kind: "and",
      children: [
        { kind: "term", value: "a" },
        { kind: "term", value: "and" },
        { kind: "term", value: "b" },
      ],
    });
  });

  it("leaves an unknown prefix as part of the term text", () => {
    expect(parseUserQuery("mesh:CRISPR")).toEqual<QueryNode>({
      kind: "term",
      value: "mesh:CRISPR",
    });
  });

  it("nests OR inside AND by precedence, and parentheses override it", () => {
    expect(parseUserQuery("a OR b AND c")).toEqual<QueryNode>({
      kind: "or",
      children: [
        { kind: "term", value: "a" },
        {
          kind: "and",
          children: [
            { kind: "term", value: "b" },
            { kind: "term", value: "c" },
          ],
        },
      ],
    });
    expect(parseUserQuery("(a OR b) c")).toEqual<QueryNode>({
      kind: "and",
      children: [
        {
          kind: "or",
          children: [
            { kind: "term", value: "a" },
            { kind: "term", value: "b" },
          ],
        },
        { kind: "term", value: "c" },
      ],
    });
  });

  it("parses a leading NOT as the unary node docs/07 §4.2 declares", () => {
    expect(parseUserQuery("NOT mouse")).toEqual<QueryNode>({
      kind: "not",
      child: { kind: "term", value: "mouse" },
    });
  });
});

describe("parseUserQuery — the never-a-syntax-error rule", () => {
  /**
   * §12.1: "Anything unparseable falls back to a single
   * `{op:'TERM', field:'all'}` node containing the raw string — **never** show a
   * syntax error for a natural-language query." `field: "all"` is the sketch's
   * spelling; `docs/07` §4.2's member is `"any"`.
   */
  const unparseable = [
    ["an unbalanced open paren", "(CRISPR AND base"],
    ["a stray close paren", "CRISPR) AND base"],
    ["an unterminated quote", 'CRISPR "base editing'],
    ["an operator with no right operand", "CRISPR AND"],
    ["an operator with no left operand", "OR mouse"],
    ["a field prefix with nothing after it", "title:"],
    ["an empty phrase", 'CRISPR ""'],
    ["parentheses nested past the depth limit", `${"(".repeat(40)}a`],
    ["nothing but punctuation", "()"],
  ] as const;

  for (const [label, input] of unparseable) {
    it(`falls back to one raw term for ${label}`, () => {
      let node: QueryNode | undefined;
      expect(() => {
        node = parseUserQuery(input);
      }).not.toThrow();
      expect(node).toEqual<QueryNode>({
        kind: "term",
        value: input,
        field: "any",
      });
    });
  }

  it("falls back for an empty box rather than returning nothing", () => {
    expect(parseUserQuery("")).toEqual<QueryNode>({
      kind: "term",
      value: "",
      field: "any",
    });
    expect(parseUserQuery("   ")).toEqual<QueryNode>({
      kind: "term",
      value: "   ",
      field: "any",
    });
  });

  it("parses a natural-language question as plain ANDed words", () => {
    // The case the fallback exists for. This one happens to parse, which is
    // the point: no error either way.
    const node = parseUserQuery("does base editing work in the liver?");
    expect(node.kind).toBe("and");
  });

  it("keeps `&`, `+`, `#` and non-Latin text inside term values", () => {
    expect(parseUserQuery("a&b+c#d 유전자편집")).toEqual<QueryNode>({
      kind: "and",
      children: [
        { kind: "term", value: "a&b+c#d" },
        { kind: "term", value: "유전자편집" },
      ],
    });
  });
});

/**
 * `P2-T01` criterion 1: "`parseUserQuery` round-trips all nine `docs/02` §12.3
 * concept rows". The table's rows are AND, OR, NOT, Phrase, Title field,
 * Abstract, Author, Date range and Pagination. The first seven are tree shapes
 * and are asserted as such. The last two are **not** nodes and never will be:
 * `P2-T01`'s own "Do NOT" forbids modelling the date window inside `QueryNode`,
 * because `fromDate`/`toDate`/`limit`/`cursor` live on `SourceQuery`
 * (`docs/07` §4.2). For those two rows "round-trip" can only mean the boundary:
 * the parser leaves date-like and paging-like text as ordinary terms, and the
 * tree it returns is carried unchanged as `SourceQuery.terms` beside the window
 * and the paging members. That is what the last two cases assert, at the type
 * level as well as at run time.
 */
describe("parseUserQuery — the nine docs/02 §12.3 concept rows", () => {
  const rows: readonly (readonly [
    row: string,
    input: string,
    tree: QueryNode,
  ])[] = [
    [
      "AND",
      "CRISPR AND liver",
      {
        kind: "and",
        children: [
          { kind: "term", value: "CRISPR" },
          { kind: "term", value: "liver" },
        ],
      },
    ],
    [
      "OR",
      "glioma OR glioblastoma",
      {
        kind: "or",
        children: [
          { kind: "term", value: "glioma" },
          { kind: "term", value: "glioblastoma" },
        ],
      },
    ],
    [
      "NOT",
      "CRISPR NOT mouse",
      {
        kind: "and",
        children: [
          { kind: "term", value: "CRISPR" },
          { kind: "not", child: { kind: "term", value: "mouse" } },
        ],
      },
    ],
    [
      "Phrase",
      '"base editing"',
      { kind: "term", value: "base editing", phrase: true },
    ],
    [
      "Title field",
      "title:CRISPR",
      { kind: "term", value: "CRISPR", field: "title" },
    ],
    [
      "Abstract",
      'abstract:"prime editing"',
      { kind: "term", value: "prime editing", field: "abstract", phrase: true },
    ],
    ["Author", "author:Liu", { kind: "term", value: "Liu", field: "author" }],
  ];

  for (const [row, input, tree] of rows) {
    it(`row "${row}": ${input}`, () => {
      expect(parseUserQuery(input)).toEqual<QueryNode>(tree);
    });
  }

  it("parses the §12.2 example into one stable tree, twice", () => {
    // Criterion 1's "one stable tree": the same input, parsed twice, yields
    // structurally identical output, and the shape is the one §12.2 renders.
    const first = parseUserQuery(EXAMPLE);
    const second = parseUserQuery(EXAMPLE);
    expect(first).toEqual(second);
    expect(first.kind).toBe("and");
    expect(first.kind === "and" && first.children.length).toBe(3);
  });

  it('row "Date range": dates are terms to the parser; the window rides on SourceQuery', () => {
    const terms = parseUserQuery("CRISPR 2024-01-01");
    // No date node exists in `docs/07` §4.2's union, and the hyphens inside
    // `2024-01-01` are not negations.
    expect(terms).toEqual<QueryNode>({
      kind: "and",
      children: [
        { kind: "term", value: "CRISPR" },
        { kind: "term", value: "2024-01-01" },
      ],
    });
    const query: SourceQuery = {
      terms,
      fromDate: "2024-01-01",
      toDate: "2026-12-31",
      limit: 100,
    };
    expect(query.terms).toBe(terms);
    expect(query.fromDate).toBe("2024-01-01");
    expect(query.toDate).toBe("2026-12-31");
  });

  it('row "Pagination": paging text is a term; limit and cursor ride on SourceQuery', () => {
    // `cursor:` is not one of the four §12.1 prefixes, so it is term text, not a
    // field. Paging is `SourceQuery.limit` / `SourceQuery.cursor` and nothing
    // the parser emits can stand in for either.
    const terms = parseUserQuery("CRISPR cursor:* retstart:100");
    expect(terms).toEqual<QueryNode>({
      kind: "and",
      children: [
        { kind: "term", value: "CRISPR" },
        { kind: "term", value: "cursor:*" },
        { kind: "term", value: "retstart:100" },
      ],
    });
    const query: SourceQuery = { terms, limit: 100, cursor: "AoJ…" };
    expect(query.terms).toBe(terms);
    expect(query.limit).toBe(100);
    expect(query.cursor).toBe("AoJ…");
  });
});

describe("parseUserQuery — P2-T01 criterion 2 and the re-export", () => {
  it('returns a single term node for `"unclosed AND (` and does not throw', () => {
    const input = '"unclosed AND (';
    let node: QueryNode | undefined;
    expect(() => {
      node = parseUserQuery(input);
    }).not.toThrow();
    expect(node).toEqual<QueryNode>({
      kind: "term",
      value: input,
      field: "any",
    });
  });

  it("is re-exported from src/sources/types as the same function", () => {
    // `P2-T01`: `types.ts` re-exports the parser's entry point only. Identity,
    // not equivalence — one module, one name.
    expect(parseUserQueryViaTypes).toBe(parseUserQuery);
  });
});

/**
 * `P2-T01` step 4. The columns below are `docs/02` §12.3's, transcribed row by
 * row: a cell reading *n/a* or *client-side* is `false` / absent, a cell with a
 * real operator or prefix is `true` / present. `keywordSearch` is the
 * `docs/07` §4.2 flag; bioRxiv's is `false` (`docs/02` §8.4).
 */
describe("normalizeForSource — docs/02 §12.3 columns", () => {
  const ALL_FIELDS: readonly QueryField[] = ["title", "abstract", "author"];

  /** AND, OR, NOT, phrase, TITLE:, ABSTRACT:, AUTH: — every cell is real. */
  const EUROPE_PMC = {
    keywordSearch: true,
    or: true,
    not: true,
    phrase: true,
    fields: ALL_FIELDS,
  };
  /** AND implicit (scored), OR n/a, NOT client-side, phrase n/a, no abstract. */
  const CROSSREF = {
    keywordSearch: true,
    or: false,
    not: false,
    phrase: false,
    fields: ["title", "author"] as const,
  };
  /** `+` `|` `-` and quotes are real; every field cell is n/a. */
  const S2_BULK = {
    keywordSearch: true,
    or: true,
    not: true,
    phrase: true,
    fields: [] as const,
  };
  /** AND, OR, ANDNOT, %22…%22, ti:, abs:, au: — every cell is real. */
  const ARXIV = {
    keywordSearch: true,
    or: true,
    not: true,
    phrase: true,
    fields: ALL_FIELDS,
  };
  /** No keyword search at all. */
  const BIORXIV = {
    keywordSearch: false,
    or: false,
    not: false,
    phrase: false,
    fields: [] as const,
  };

  it("reports nothing for a source whose column has no n/a cell", () => {
    const tree = parseUserQuery(EXAMPLE);
    expect(normalizeForSource(tree, EUROPE_PMC)).toEqual([]);
    expect(normalizeForSource(tree, ARXIV)).toEqual([]);
  });

  it("reports Crossref's four losses on the §12.2 example, in document order, by reference", () => {
    const tree = parseUserQuery(EXAMPLE);
    if (tree.kind !== "and") throw new Error("example did not parse to `and`");
    const [orGroup, titleTerm, notClause] = tree.children;
    if (orGroup?.kind !== "or" || notClause?.kind !== "not") {
      throw new Error("example lost its shape");
    }
    const [basePhrase, primePhrase] = orGroup.children;

    const lost = normalizeForSource(tree, CROSSREF);

    // The OR group, both phrases inside it, and the NOT clause. `title:CRISPR`
    // is `query.title` and `mouse` is a bare word, so neither is reported.
    expect(lost).toHaveLength(4);
    expect(lost[0]).toBe(orGroup);
    expect(lost[1]).toBe(basePhrase);
    expect(lost[2]).toBe(primePhrase);
    expect(lost[3]).toBe(notClause);
    expect(lost).not.toContain(titleTerm);
    // Shape, for the reader: these are the §12.3 cells that read n/a.
    expect(lost.map((n) => n.kind)).toEqual(["or", "term", "term", "not"]);
    expect(lost[1]).toEqual({
      kind: "term",
      value: "base editing",
      phrase: true,
    });
  });

  it("reports only the fielded term for Semantic Scholar bulk, which has no field syntax", () => {
    const tree = parseUserQuery(EXAMPLE);
    const lost = normalizeForSource(tree, S2_BULK);
    expect(lost).toEqual<readonly QueryNode[]>([
      { kind: "term", value: "CRISPR", field: "title" },
    ]);
  });

  it("reports an abstract: term for Crossref but not an author: term", () => {
    expect(normalizeForSource(parseUserQuery("abstract:x"), CROSSREF)).toEqual<
      readonly QueryNode[]
    >([{ kind: "term", value: "x", field: "abstract" }]);
    expect(normalizeForSource(parseUserQuery("author:x"), CROSSREF)).toEqual(
      [],
    );
  });

  it("reports the whole tree as its root, once, when keywordSearch is false", () => {
    // `docs/02` §8.4 / `P2-T01` Do NOT: emit no query for such a source. One
    // entry, the root itself, for a plain word and for the full example alike.
    const word = parseUserQuery("CRISPR");
    const lostWord = normalizeForSource(word, BIORXIV);
    expect(lostWord).toHaveLength(1);
    expect(lostWord[0]).toBe(word);

    const tree = parseUserQuery(EXAMPLE);
    const lostTree = normalizeForSource(tree, BIORXIV);
    expect(lostTree).toHaveLength(1);
    expect(lostTree[0]).toBe(tree);
  });

  it('never reports `and`, an unfielded term, or an explicit field: "any"', () => {
    // `"any"` is the raw-string fallback's field (§12.1) and means "no field
    // restriction", so even a column with an empty `fields` list renders it.
    const fallback = parseUserQuery('"unclosed AND (');
    if (fallback.kind !== "term") throw new Error("fallback is not a term");
    expect(fallback.field).toBe("any");
    expect(normalizeForSource(fallback, S2_BULK)).toEqual([]);
    expect(normalizeForSource(fallback, CROSSREF)).toEqual([]);
    expect(normalizeForSource(parseUserQuery("a b c"), CROSSREF)).toEqual([]);
  });

  it("keeps walking below a reported node, so a phrase inside a NOT is its own loss", () => {
    const tree = parseUserQuery('CRISPR NOT "mouse model"');
    if (tree.kind !== "and") throw new Error("did not parse to `and`");
    const notClause = tree.children[1];
    if (notClause?.kind !== "not") throw new Error("second child is not `not`");

    const lost = normalizeForSource(tree, CROSSREF);
    expect(lost).toHaveLength(2);
    expect(lost[0]).toBe(notClause);
    expect(lost[1]).toBe(notClause.child);
  });

  it("does not modify the tree it is given", () => {
    const tree = deepFreeze(parseUserQuery(EXAMPLE));
    const before = JSON.stringify(tree);
    // ES modules are strict, so a write to a frozen object throws; the
    // `not.toThrow` is therefore a real mutation check, not decoration.
    expect(() => normalizeForSource(tree, CROSSREF)).not.toThrow();
    expect(() => normalizeForSource(tree, BIORXIV)).not.toThrow();
    expect(JSON.stringify(tree)).toBe(before);
  });
});

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const member of Object.values(value)) deepFreeze(member);
    Object.freeze(value);
  }
  return value;
}
