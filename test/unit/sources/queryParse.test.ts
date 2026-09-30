import { describe, expect, it } from "vitest";

import { parseUserQuery } from "../../../src/sources/shared/queryParse";
import type { QueryNode } from "../../../src/sources/types";

/**
 * `P1-T08` step 1. Layer 1 (`docs/13` §2.1): plain Node, no Zotero, no network.
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
