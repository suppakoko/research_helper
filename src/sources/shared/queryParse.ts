/**
 * The user's one search box → a {@link QueryNode} tree.
 *
 * **Scope.** `P1-T08` step 1. Source-agnostic on purpose: every adapter renders
 * the same tree into its own syntax (`docs/02` §12.2), so the parse happens
 * once, here, and each `sources/<id>/query.ts` only renders.
 *
 * **Authority for the types.** `docs/07-architecture-and-data-model.md` §4.2
 * declares `QueryNode` and `QueryField`, and `src/sources/types.ts` transcribes
 * them. `docs/02` §12.1 prints a shorter-named sketch (`op`/`text`,
 * `titleAbstract`, `venue`, `all`) under its own authority note saying "doc 07
 * wins … Do not declare a second `QueryNode` or `QueryField`". Nothing is
 * declared here; both types are imported.
 *
 * **What `docs/02` §12.1 asks the syntax to accept** — "a deliberately small
 * user syntax":
 *
 * - quotes for phrases,
 * - `AND` / `OR` / `NOT`, and `-` for NOT,
 * - parentheses,
 * - `field:` prefixes (`title:`, `abstract:`, `author:`, `journal:`),
 * - bare space-separated words default to AND,
 * - **anything unparseable falls back to a single `{ kind: "term", field:
 *   "any" }` node containing the raw string — "never show a syntax error for a
 *   natural-language query".**
 *
 * The last rule is why {@link parseUserQuery} does not throw and has no error
 * channel: there is no caller that could usefully be told. Every internal
 * syntax failure is caught at the boundary and becomes the raw-string node.
 *
 * ## Two decisions the corpus leaves open, recorded rather than buried
 *
 * 1. **Boolean keywords are recognised in uppercase only.** §12.1 writes them
 *    as `AND`/`OR`/`NOT` and never says whether `and` is an operator. Lowercase
 *    is treated as an ordinary word, which is also PubMed's own rule
 *    (`docs/02` §12.2: PubMed "silently treats a lowercase `and` as a search
 *    term"). The cost is that a natural-language "cancer and diabetes" carries
 *    a literal `and` term; the benefit is that "patients not receiving therapy"
 *    does not silently become a negation. Since bare words already default to
 *    AND, the lowercase-`and` case costs nothing but one stopword, which is
 *    exactly what PubMed's own translation drops.
 * 2. **Only the four `field:` prefixes §12.1 names are accepted.** `QueryField`
 *    has eight members; `titleOrAbstract`, `affiliation`, `meshTerm` and `any`
 *    get no user-facing prefix here because §12.1 lists four and inventing
 *    three more spellings is a product decision, not a transcription. Adapters
 *    still render all eight — a tree built by something other than this parser
 *    (`docs/02` §12.4's field routing, for instance) is rendered faithfully.
 *
 * **Layering.** `sources/` imports `core/` and `model/` only (`docs/07` §2.3).
 * This file imports neither: two types from its own directory tree, nothing
 * else.
 */

import type { QueryField, QueryNode } from "../types";

/**
 * The `field:` prefixes `docs/02` §12.1 names, mapped onto `docs/07` §4.2's
 * `QueryField` members. Compared case-insensitively.
 *
 * The right-hand side is the shipped spelling, not §12.1's sketch: `journal:`
 * maps to `"journal"` (the sketch called it `venue`), and nothing maps to
 * `"any"` because `"any"` is the *absence* of a prefix.
 */
export const USER_FIELD_PREFIXES: ReadonlyMap<string, QueryField> = new Map<
  string,
  QueryField
>([
  ["title", "title"],
  ["abstract", "abstract"],
  ["author", "author"],
  ["journal", "journal"],
]);

/**
 * How deep parentheses may nest before the input is declared unparseable.
 *
 * A limit rather than unbounded recursion: the plugin sandbox is a shared
 * process and `((((((…` from a paste should degrade to §12.1's raw-string
 * fallback, not unwind a stack overflow through the job queue. Thirty-two is
 * far past any hand-written query.
 */
const MAX_PAREN_DEPTH = 32;

/** Characters that end an unquoted word. */
const WORD_BOUNDARY = new Set(["(", ")", '"']);

/** Internal only: every throw is caught by {@link parseUserQuery}. */
class QuerySyntaxError extends Error {}

type Token =
  | { readonly kind: "lparen" }
  | { readonly kind: "rparen" }
  | { readonly kind: "and" }
  | { readonly kind: "or" }
  | { readonly kind: "not" }
  /** A bare `title:` with its value in the next token. */
  | { readonly kind: "fieldPrefix"; readonly field: QueryField }
  | {
      readonly kind: "text";
      readonly value: string;
      readonly phrase: boolean;
      readonly field?: QueryField;
    };

/**
 * Parse the string the user typed into the search box.
 *
 * Never throws and never reports a syntax error: `docs/02` §12.1 forbids one.
 *
 * @param input - the raw contents of the search box
 * @returns the parsed tree, or a single `{ kind: "term", field: "any" }` node
 *   carrying `input` verbatim when the string is not the small syntax §12.1
 *   accepts
 */
export function parseUserQuery(input: string): QueryNode {
  try {
    const tokens = tokenize(input);
    if (tokens.length === 0) return rawTermNode(input);
    const parser = new Parser(tokens);
    const node = parser.parseOr();
    parser.expectEnd();
    return node;
  } catch {
    return rawTermNode(input);
  }
}

/**
 * §12.1's fallback: the whole string as one unfielded term.
 *
 * `field: "any"` is set explicitly rather than left absent. `"any"` and absent
 * render identically (`[All Fields]` for PubMed), but §12.1 spells the fallback
 * with the field present, and a reader of a logged tree can then tell "the
 * parser gave up" apart from "the user typed one word".
 */
function rawTermNode(input: string): QueryNode {
  return { kind: "term", value: input, field: "any" };
}

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const ch = input.charAt(i);

    if (isWhitespace(ch)) {
      i += 1;
      continue;
    }

    if (ch === "(") {
      tokens.push({ kind: "lparen" });
      i += 1;
      continue;
    }

    if (ch === ")") {
      tokens.push({ kind: "rparen" });
      i += 1;
      continue;
    }

    if (ch === '"') {
      const end = input.indexOf('"', i + 1);
      if (end === -1) {
        // An unterminated quote is unparseable, which §12.1 turns into the
        // raw-string fallback rather than an error message.
        throw new QuerySyntaxError("unterminated quoted phrase");
      }
      tokens.push({
        kind: "text",
        value: input.slice(i + 1, end),
        phrase: true,
      });
      i = end + 1;
      continue;
    }

    if (ch === "-" && startsNegation(input, i)) {
      tokens.push({ kind: "not" });
      i += 1;
      continue;
    }

    let end = i;
    while (end < input.length && !isWordBoundary(input.charAt(end))) end += 1;
    tokens.push(wordToken(input.slice(i, end)));
    i = end;
  }

  return tokens;
}

function isWhitespace(ch: string): boolean {
  return /\s/u.test(ch);
}

function isWordBoundary(ch: string): boolean {
  return isWhitespace(ch) || WORD_BOUNDARY.has(ch);
}

/**
 * Is the `-` at `index` §12.1's NOT operator, or part of a term?
 *
 * A hyphen only reaches this test at the *start* of a token — the word scanner
 * treats `-` as an ordinary word character, so the hyphen in `CRISPR-Cas9` is
 * consumed inside the word and never asked about. That is deliberate:
 * hyphenated gene and method names are the common case in this corpus, and
 * `docs/02` §12.2 has to strip hyphens only for Semantic Scholar, whose own
 * spec says hyphenated terms yield no matches.
 *
 * So the operator reading needs the hyphen to be followed by something to
 * negate: a further `-`, a closing paren or whitespace is not that.
 */
function startsNegation(input: string, index: number): boolean {
  const next = input.charAt(index + 1);
  if (next === "") return false;
  return !isWhitespace(next) && next !== ")" && next !== "-";
}

function wordToken(word: string): Token {
  if (word === "AND") return { kind: "and" };
  if (word === "OR") return { kind: "or" };
  if (word === "NOT") return { kind: "not" };

  const colon = word.indexOf(":");
  if (colon > 0) {
    const field = USER_FIELD_PREFIXES.get(word.slice(0, colon).toLowerCase());
    if (field !== undefined) {
      const rest = word.slice(colon + 1);
      // `title:` alone — the value is the next token, which lets
      // `title:"prime editing"` and `title: CRISPR` both work.
      if (rest === "") return { kind: "fieldPrefix", field };
      return { kind: "text", value: rest, phrase: false, field };
    }
  }

  return { kind: "text", value: word, phrase: false };
}

// ---------------------------------------------------------------------------
// Recursive-descent parser
// ---------------------------------------------------------------------------

/**
 * ```
 * or      := and ( "OR" and )*
 * and     := unary ( ( "AND" | "NOT" | <implicit> ) unary )*
 * unary   := ( "NOT" | "-" ) unary | primary
 * primary := "(" or ")" | fieldPrefix text | text
 * ```
 *
 * `NOT` appears in two places because it is two things. §12.1 lists it among
 * the Booleans, which is PubMed's binary `A NOT B` ("A and not B"), while
 * `docs/07` §4.2's node is unary (`{ kind: "not"; child }`). The binary form is
 * therefore parsed as an `and` whose last child is a `not` — the shape the
 * renderers then collapse back into `A NOT B`.
 */
class Parser {
  private index = 0;
  private depth = 0;

  constructor(private readonly tokens: readonly Token[]) {}

  parseOr(): QueryNode {
    const children: QueryNode[] = [this.parseAnd()];
    while (this.peek()?.kind === "or") {
      this.index += 1;
      children.push(this.parseAnd());
    }
    return children.length === 1 ? firstOf(children) : { kind: "or", children };
  }

  private parseAnd(): QueryNode {
    const children: QueryNode[] = [this.parseUnary()];

    for (;;) {
      const token = this.peek();
      if (token === undefined) break;
      if (token.kind === "rparen" || token.kind === "or") break;

      if (token.kind === "and") {
        this.index += 1;
        children.push(this.parseUnary());
        continue;
      }

      if (token.kind === "not") {
        // Binary `A NOT B`. The unary branch in `parseUnary` only sees a `NOT`
        // that has no left operand.
        this.index += 1;
        children.push({ kind: "not", child: this.parseUnary() });
        continue;
      }

      // §12.1: "Bare space-separated words default to AND."
      children.push(this.parseUnary());
    }

    return children.length === 1
      ? firstOf(children)
      : { kind: "and", children };
  }

  private parseUnary(): QueryNode {
    if (this.peek()?.kind === "not") {
      this.index += 1;
      return { kind: "not", child: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): QueryNode {
    const token = this.next();
    if (token === undefined) {
      throw new QuerySyntaxError("query ended where a term was expected");
    }

    if (token.kind === "lparen") {
      this.depth += 1;
      if (this.depth > MAX_PAREN_DEPTH) {
        throw new QuerySyntaxError("parentheses nested too deeply");
      }
      const inner = this.parseOr();
      const close = this.next();
      if (close?.kind !== "rparen") {
        throw new QuerySyntaxError("unbalanced parenthesis");
      }
      this.depth -= 1;
      return inner;
    }

    if (token.kind === "fieldPrefix") {
      const value = this.next();
      if (value?.kind !== "text") {
        throw new QuerySyntaxError("field prefix with no term after it");
      }
      return termNode(value.value, value.phrase, token.field);
    }

    if (token.kind === "text") {
      return termNode(token.value, token.phrase, token.field);
    }

    throw new QuerySyntaxError(`operator "${token.kind}" where a term belongs`);
  }

  expectEnd(): void {
    if (this.index !== this.tokens.length) {
      throw new QuerySyntaxError("trailing input");
    }
  }

  private peek(): Token | undefined {
    return this.tokens[this.index];
  }

  private next(): Token | undefined {
    const token = this.tokens[this.index];
    this.index += 1;
    return token;
  }
}

/**
 * Build a term node.
 *
 * `exactOptionalPropertyTypes` is on (`tsconfig.json`, `docs/13` §1.5), so the
 * optional members are spread in conditionally rather than assigned
 * `undefined`: `{ field: undefined }` is not assignable to `field?: QueryField`
 * under that flag.
 */
function termNode(
  value: string,
  phrase: boolean,
  field: QueryField | undefined,
): QueryNode {
  const trimmed = value.trim();
  if (trimmed === "") {
    // An empty phrase (`""`) or a lone `field:` with nothing usable after it.
    // Unparseable, so §12.1's fallback rather than a node that renders to
    // nothing.
    throw new QuerySyntaxError("empty term");
  }
  return {
    kind: "term",
    value: trimmed,
    ...(field !== undefined && { field }),
    ...(phrase && { phrase: true }),
  };
}

/** `noUncheckedIndexedAccess` makes `children[0]` optional; it is not. */
function firstOf(children: readonly QueryNode[]): QueryNode {
  const first = children[0];
  if (first === undefined) {
    throw new QuerySyntaxError("empty group");
  }
  return first;
}
