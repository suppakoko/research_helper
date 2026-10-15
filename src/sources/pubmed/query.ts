/**
 * PubMed query rendering: a {@link SourceQuery} → an Entrez `term`, the
 * `esearch` parameter set, and the native rendering the UI previews.
 *
 * **Scope.** `P1-T08` steps 2–5. Rendering only — no HTTP, no response
 * handling, no paging policy. `P1-T09` owns `esearch`/`efetch` and passes
 * `retmax`, `retstart`, `retmode` and the optional `api_key` in here.
 *
 * **Read this if you are about to change the Booleans.** `docs/02` §12.2:
 * Booleans "**must be uppercase**" — PubMed silently treats a lowercase `and`
 * as a search term, so a lowercased operator does not fail, it returns the
 * wrong papers. {@link renderPubmedTerm} emits `AND` / `OR` / `NOT` and nothing
 * else.
 *
 * ## The date window, and which of PubMed's three mechanisms this uses
 *
 * `docs/02` §3.3 gives three interchangeable mechanisms: (a) `reldate` = last
 * *n* days, (b) `mindate`/`maxdate`, (c) an in-term `[PDAT]`/`[EDAT]` range.
 *
 * - **What is transmitted is (b)**, per `P1-T08` step 3, with `datetype=edat`.
 *   §3.3's ruling: `edat` (the date the record entered PubMed) "is more stable
 *   and better matches 'recently published research'", because `pdat` for an
 *   ahead-of-print record can be a *future* cover date — observed live, a
 *   record dated `2026 Sep` returned by a search run in September 2026 for a
 *   print issue not yet distributed. `pdat` is the advanced option, reachable
 *   through {@link PubmedEsearchOptions.datetype} and defaulted nowhere else.
 *   §3.3 also marks `mindate` and `maxdate` "**both required together**", which
 *   {@link buildEsearchRequest} enforces by refusing a half-open window.
 * - **(a) `reldate=1095` is never emitted.** It is a *rolling-days* mechanism,
 *   and the window is three **calendar** years — the current year and the two
 *   before it (`docs/08` §4.2 owns the computation, `docs/10` FR-3 is the
 *   requirement as rewritten on 2026-09-09, `docs/02` §2.0 says the same
 *   corpus-wide, and `plan/02-phase-1-pubmed.md` §4 closes it as conflict
 *   **C10**). Mixing the two makes §4.2's `2024 – 2026` label lie. Nothing here
 *   computes a window either: `src/sources/shared/recency.ts`'s
 *   `recencyWindow()` returns the bounds and the label from one pair of years
 *   precisely so query and label cannot drift, and this file only formats the
 *   `fromDate` / `toDate` it is handed on the `SourceQuery`.
 * - **(c) is what {@link explainPubmedQuery} shows**, because it is the one
 *   rendering that fits in a single string the user can read, and it is the
 *   form `docs/02` §12.2 prints for this exact example query. It is the same
 *   filter in a different mechanism, not a different filter.
 *
 * ## The three optional `SourceQuery` filters (`P2-T20`)
 *
 * `docs/07` §4.2 declares `languages`, `openAccessOnly` and `raw` on
 * `SourceQuery`; `P1-T08` rendered none of them, so a caller that set one had
 * it dropped and saw only a quietly wrong result count. Each now has one
 * stated fate. The flag a caller reads before relying on `languages` or
 * `openAccessOnly` is `PUBMED_CAPABILITIES.filters` — {@link PUBMED_FILTERS},
 * the object this renderer refuses from (`P2-T34`, `docs/07` §4.2, 2026-10-15);
 * `raw` stays in {@link PUBMED_QUERY_FILTER_SUPPORT}:
 *
 * - **`languages` is rendered**, in the `term`, as `eng[la]` — or
 *   `(eng[la] OR kor[la])` for several — joined to the Boolean term with
 *   `AND`. `[la]` is the tag `docs/02` §12.2/§12.3 document for PubMed;
 *   `[Language]` is Entrez's long spelling of the same field. **The values
 *   are converted (`P2-T36`, owner review row 114):** `docs/07` §4.2 makes the
 *   pipeline carry two-letter ISO-639-1 codes only and each adapter convert,
 *   so `en` becomes MEDLINE's `eng` through {@link PUBMED_LANGUAGE_CODES}, and
 *   a code the table lacks is refused with a `RangeError` naming it — never
 *   passed through, because an untranslated code matches nothing. (Until
 *   2026-10-15 values were passed through verbatim, the code set being
 *   unsettled.)
 * - **`openAccessOnly: true` is rendered** as {@link PUBMED_OPEN_ACCESS_CLAUSE},
 *   `free full text[sb]`, joined with `AND` after the language clause, on the
 *   wire and in the preview. `docs/02` §12.2/§12.3 carry the row since
 *   2026-10-15 (owner review row 112) and made one live request the condition
 *   for rendering it; that request was made by `P2-T36` and is recorded at
 *   the constant. Until then the member was refused by name, and
 *   {@link assertExpressible} still refuses it if {@link PUBMED_FILTERS} ever
 *   turned off again — refusing, not dropping, is `docs/07` §11.1 step 2's
 *   "do not fake it", and the pipeline turns such a throw into that source's
 *   `report.error` (`stages.ts`, `fetchOne`).
 * - **`raw` is a bag of extra `esearch` parameters, appended; it never touches
 *   `term`.** The parser is not bypassed by it: `raw.term` — and every other
 *   key this module emits itself, plus `reldate` — is reserved and refused
 *   with `RangeError` ({@link RESERVED_RAW_PARAMS}), so `raw` can neither
 *   replace nor extend the rendered Boolean term, and cannot displace the D10
 *   identification parameters or the credential. When `raw` and a parsed query
 *   are both present, both are transmitted, independently: `term` is exactly
 *   {@link renderPubmedTerm}'s output and the raw pairs follow `maxdate`,
 *   sorted by key for byte stability. Every key and value is
 *   `encodeURIComponent`-ed; a value is `String(value)`, so a caller wanting
 *   Entrez's `y`/`n` passes the string, not a boolean. `raw` does not appear in
 *   {@link explainPubmedQuery}, which renders the `term` alone; it is visible
 *   in {@link PubmedEsearchRequest.transmittedQuery}.
 *
 * ## Layering
 *
 * `sources/` may import `core/` and `model/` and must not import `pipeline/`,
 * `ui/` or `zotero/`, nor name the `Zotero` global (`docs/07` §2.3 / §4.2,
 * enforced by `eslint.config.js`). The two `core/` imports below are the
 * identification parameters (D10) and the redaction backstop; there is no
 * platform access of any kind.
 */

import { redactUrl } from "../../core/errors";
import { ncbiIdentityParams } from "../../core/http/userAgent";
import type {
  QueryField,
  QueryNode,
  SourceCapabilities,
  SourceQuery,
} from "../types";

/** `esearch` endpoint, `docs/02` §3.1 + §3.2. No query string. */
export const PUBMED_ESEARCH_BASE_URL =
  "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi";

/**
 * `docs/02` §3.3's `datetype`. `mdat` (modification date) is deliberately
 * absent: it describes when NCBI last edited the record, which is not a
 * publication-recency notion and no requirement asks for it.
 */
export type PubmedDateType = "edat" | "pdat";

/**
 * The field tags of `docs/02` §12.2, one per `docs/07` §4.2 `QueryField`
 * member.
 *
 * Two entries need a word of explanation:
 *
 * - **`abstract` and `titleOrAbstract` both render `[Title/Abstract]`.** PubMed
 *   has no abstract-only tag; `[Title/Abstract]` (`[TIAB]`) is the narrowest
 *   thing it offers, and §12.3's translation table maps the "Abstract" concept
 *   to exactly that. The mapping is therefore *widening* for `abstract` — a
 *   title hit satisfies an `abstract:` term — which is a property of PubMed, not
 *   a bug here.
 * - **`affiliation` renders `[Affiliation]`, which §12.2 does not list.** §12.2
 *   names six tags and `QueryField` has eight members; `[Affiliation]` is a real
 *   Entrez tag and the alternative — collapsing it into `[All Fields]` — would
 *   silently widen an affiliation filter to the whole record. Recorded as a
 *   corpus gap in `P1-T08`'s findings rather than papered over.
 */
const FIELD_TAGS: Readonly<Record<QueryField, string>> = {
  title: "[Title]",
  abstract: "[Title/Abstract]",
  titleOrAbstract: "[Title/Abstract]",
  author: "[Author]",
  journal: "[Journal]",
  affiliation: "[Affiliation]",
  meshTerm: "[MeSH Terms]",
  any: "[All Fields]",
};

/**
 * Characters removed from a term's text because they *are* Entrez syntax.
 *
 * `"` delimits a phrase, `(` / `)` group, `[` / `]` delimit a field tag. A term
 * value carrying any of them would either change the query's structure or make
 * it unparseable — and the values reaching here include
 * `src/sources/shared/queryParse.ts`'s raw-string fallback, which is by
 * definition whatever the user typed. Stripping is what makes
 * "every rendered term has balanced parentheses" true of *all* input rather
 * than of well-formed input.
 *
 * Everything else survives, `&` `+` `#` and non-Latin scripts included: those
 * are URL-encoding problems, not syntax problems, and
 * {@link buildEsearchRequest} handles them there.
 */
const ENTREZ_SYNTAX_CHARS = /["()[\]]/gu;

/**
 * A value safe to leave unquoted: letters, digits, `_` and `-` only.
 *
 * Hyphens stay, unquoted and unmodified — `CRISPR-Cas9` is the common case in
 * this corpus and PubMed handles it. (`docs/02` §12.2's hyphen-stripping
 * warning is Semantic Scholar's alone.)
 */
const BARE_VALUE = /^[\p{L}\p{N}_-]+$/u;

/**
 * PubMed's language field tag, as the corpus spells it (`docs/12`'s PubMed
 * syntax rules: "`[la]` (language)"; `docs/02` §12.2/§12.3 since 2026-10-15).
 * Entrez also accepts the long form `[Language]`; the two name one field.
 */
const LANGUAGE_TAG = "[la]";

/**
 * Two-letter ISO-639-1 code → the three-letter MEDLINE code `[la]` takes
 * (`P2-T36`, owner review of 2026-10-14 row 114).
 *
 * `docs/07` §4.2: the pipeline carries **only** two-letter codes and each
 * adapter converts to its own set, refusing by name a code it cannot map.
 * The table holds the languages `docs/02` §12.2 names for PubMed — `eng[la]`
 * and `kor[la]` — and nothing more: a row added here is a claim about
 * MEDLINE's code list, so it belongs in that section first. Keys are matched
 * exactly (lower case, as ISO-639-1 writes them); anything else is refused by
 * {@link renderPubmedSearchTerm} with a `RangeError` naming the code.
 */
export const PUBMED_LANGUAGE_CODES: Readonly<Record<string, string>> =
  Object.freeze({
    en: "eng",
    ko: "kor",
  });

/**
 * PubMed's open-access filter, `docs/02` §12.2/§12.3's **`free full
 * text[sb]`** — a subset (`[sb]`) clause, joined to the term with `AND`.
 *
 * **Confirmed by one live request on 2026-10-15 (`P2-T36`)**, the condition
 * §12.2 set before the code may render it. An unauthenticated `esearch`,
 * built by {@link buildEsearchRequest} for the recorder's `QUERY_TYPICAL`
 * (`CRISPR` AND `editing`, entry dates 2023-01-01 – 2023-03-31) with
 * `openAccessOnly: true` and `retmax=0`, answered HTTP 200 with `count`
 * `"611"`, no `ERROR`, no `errorlist` and no `warninglist`; its
 * `translationset` maps `free full text[sb]` to `"loattrfree full text"[sb]`
 * and its `querytranslation` ends `AND "loattrfree full text"[Filter] AND
 * 2023/01/01:2023/03/31[Date - Entry]`. The same query without the clause
 * is the committed `search-typical` fixture, `count` `"840"` (recorded
 * 2026-10-07): the clause is recognised and narrows to a non-empty subset.
 */
export const PUBMED_OPEN_ACCESS_CLAUSE = "free full text[sb]";

/**
 * PubMed's answer to `docs/07` §4.2's `SourceCapabilities.filters`: both
 * `true` since `P2-T36` (2026-10-15); the module header says how each is
 * rendered. **The object `PUBMED_CAPABILITIES.filters` is** — `pubmedSource.ts`
 * assigns this constant rather than a copy — and {@link assertExpressible}
 * refuses from it, so the declaration a caller reads and the renderer's
 * behaviour cannot drift (`P2-T34`, the pattern `query.fields` uses). A
 * member set to `false` is **refused** with `RangeError` by
 * {@link buildEsearchRequest} and {@link explainPubmedQuery} when the query
 * sets it, never dropped (`docs/07` §11.1 step 2: "do not fake it").
 */
export const PUBMED_FILTERS: SourceCapabilities["filters"] = {
  languages: true,
  openAccess: true,
};

/**
 * The optional `SourceQuery` member that stays adapter-level — `raw`, which
 * `docs/07` §4.2 leaves "documented per adapter". Derived from the contract,
 * not re-declared, so a member renamed there fails here. `languages` and
 * `openAccessOnly` moved to {@link PUBMED_FILTERS} on 2026-10-15 (`P2-T34`).
 */
export type PubmedQueryFilter = keyof Pick<SourceQuery, "raw">;

/** Whether `raw` is honoured: `true` — the module header says how. */
export const PUBMED_QUERY_FILTER_SUPPORT: Readonly<
  Record<PubmedQueryFilter, boolean>
> = {
  raw: true,
};

/**
 * Render a query tree into an Entrez `term`.
 *
 * @param node - the tree, from `parseUserQuery` or from anything else that
 *   builds a `docs/07` §4.2 `QueryNode`
 * @returns the term, with uppercase Booleans and balanced parentheses; `""`
 *   when the tree carries no renderable term at all
 *
 * **`NOT` is rendered binary.** `docs/07` §4.2's node is unary, but Entrez has
 * no unary `NOT` and `AND NOT` is not its spelling — `NOT` already means "and
 * not". So a `not` child of an `and` contributes `NOT x` *in place of* the
 * `AND` that would otherwise join it, which is what produces §12.2's
 * `… AND CRISPR[Title] NOT mouse[All Fields]`. A `not` that has no left operand
 * (top level, or inside an `or`) is rendered as a bare `NOT x`: PubMed will
 * reject it, and that is the honest outcome — inventing an `All Fields` left
 * operand would silently turn "not mouse" into "everything except mouse", a
 * multi-million-record query.
 */
export function renderPubmedTerm(node: QueryNode): string {
  switch (node.kind) {
    case "term":
      return renderTerm(node.value, node.field, node.phrase === true);

    case "not": {
      const inner = renderPubmedTerm(node.child);
      return inner === "" ? "" : `NOT ${inner}`;
    }

    case "or": {
      const parts = node.children
        .map((child) => renderPubmedTerm(child))
        .filter((part) => part !== "");
      if (parts.length === 0) return "";
      if (parts.length === 1) return firstPart(parts);
      return `(${parts.join(" OR ")})`;
    }

    case "and": {
      // Each entry is already prefixed with `NOT ` when it came from a `not`
      // child, so the join below knows not to add an `AND` in front of it.
      const parts: string[] = [];
      for (const child of node.children) {
        const rendered = renderPubmedTerm(child);
        if (rendered !== "") parts.push(rendered);
      }
      if (parts.length === 0) return "";
      if (parts.length === 1) return firstPart(parts);

      let out = firstPart(parts);
      for (const part of parts.slice(1)) {
        out += part.startsWith("NOT ") ? ` ${part}` : ` AND ${part}`;
      }
      return `(${out})`;
    }
  }
}

/** One `value[Tag]` atom. */
function renderTerm(
  value: string,
  field: QueryField | undefined,
  phrase: boolean,
): string {
  return renderAtom(value, FIELD_TAGS[field ?? "any"], phrase);
}

/**
 * One `value[tag]` atom for any Entrez tag: syntax characters stripped,
 * whitespace collapsed, quoted when the value is not a bare word or is a
 * phrase. `""` when nothing renderable is left.
 */
function renderAtom(value: string, tag: string, phrase: boolean): string {
  const cleaned = value.replace(ENTREZ_SYNTAX_CHARS, " ").trim();
  if (cleaned === "") return "";
  const collapsed = cleaned.replace(/\s+/gu, " ");
  const quoted = phrase || !BARE_VALUE.test(collapsed);
  return quoted ? `"${collapsed}"${tag}` : `${collapsed}${tag}`;
}

/**
 * The `languages` filter as an Entrez clause: each two-letter code converted
 * through {@link PUBMED_LANGUAGE_CODES}, then `eng[la]`, or
 * `(eng[la] OR kor[la])` for several — a list of languages is a disjunction,
 * "any of these". A code given twice is rendered once. `""` when the member
 * is absent or the list is empty.
 *
 * @throws RangeError naming the first code the table does not map — passing
 *   it through untranslated would ask PubMed for a language that does not
 *   exist and return a quietly empty or wrong result (`docs/07` §4.2)
 */
function renderLanguageClause(languages: readonly string[]): string {
  if (languages.length === 0) return "";
  const codes: string[] = [];
  for (const language of languages) {
    const code = Object.hasOwn(PUBMED_LANGUAGE_CODES, language)
      ? PUBMED_LANGUAGE_CODES[language]
      : undefined;
    if (code === undefined) {
      throw new RangeError(
        `[research-helper] PubMed cannot render SourceQuery.languages code ` +
          `${JSON.stringify(language)}: PUBMED_LANGUAGE_CODES maps only ` +
          `${Object.keys(PUBMED_LANGUAGE_CODES).join(", ")} (two-letter ` +
          `ISO-639-1, docs/07 §4.2) to MEDLINE's three-letter codes, and an ` +
          `untranslated code would silently match nothing.`,
      );
    }
    if (!codes.includes(code)) codes.push(code);
  }
  const atoms = codes.map((code) => renderAtom(code, LANGUAGE_TAG, false));
  if (atoms.length === 1) return firstPart(atoms);
  return `(${atoms.join(" OR ")})`;
}

/**
 * Refuse every optional filter this adapter cannot express — read off
 * {@link PUBMED_FILTERS}, the object `PUBMED_CAPABILITIES.filters` is — by
 * name, so the drop is an error at the call site and never a quietly
 * different result set.
 *
 * An empty `languages` list and `openAccessOnly: false` ask for nothing and
 * pass.
 */
function assertExpressible(query: SourceQuery): void {
  if (
    query.languages !== undefined &&
    query.languages.length > 0 &&
    !PUBMED_FILTERS.languages
  ) {
    throw new RangeError(
      `[research-helper] PubMed cannot express SourceQuery.languages: ` +
        `the member would otherwise be silently dropped. ` +
        `PUBMED_CAPABILITIES.filters.languages is false.`,
    );
  }
  if (query.openAccessOnly === true && !PUBMED_FILTERS.openAccess) {
    throw new RangeError(
      `[research-helper] PubMed cannot express SourceQuery.openAccessOnly: ` +
        `the member would otherwise be silently dropped. ` +
        `PUBMED_CAPABILITIES.filters.openAccess is false.`,
    );
  }
}

/**
 * The `term` this adapter transmits for a query: {@link renderPubmedTerm}'s
 * rendering of `terms`, then the `languages` clause, then — for
 * `openAccessOnly: true` — {@link PUBMED_OPEN_ACCESS_CLAUSE}, each joined with
 * `AND`. The one place they are combined, so {@link explainPubmedQuery} and
 * {@link buildEsearchRequest} cannot drift.
 *
 * @throws RangeError for an unexpressible filter ({@link assertExpressible})
 *   or a `languages` code the table cannot map ({@link renderLanguageClause})
 */
export function renderPubmedSearchTerm(query: SourceQuery): string {
  assertExpressible(query);
  const parts = [
    renderPubmedTerm(query.terms),
    renderLanguageClause(query.languages ?? []),
    query.openAccessOnly === true ? PUBMED_OPEN_ACCESS_CLAUSE : "",
  ].filter((part) => part !== "");
  return parts.join(" AND ");
}

/** `noUncheckedIndexedAccess` makes `parts[0]` optional; the caller checked. */
function firstPart(parts: readonly string[]): string {
  return parts[0] ?? "";
}

/**
 * The native rendering shown in the UI preview and stored with the run —
 * `LiteratureSource.explainQuery`'s return value (`docs/07` §4.2: "Render the
 * normalized query into this source's native syntax (for UI preview + logs)").
 *
 * This is the one string that shows the date window too, in `docs/02` §3.3's
 * in-term form (mechanism (c)), because a preview has to fit in one line and
 * because it is the form §12.2 prints. What goes on the wire is
 * `mindate`/`maxdate` — {@link buildEsearchRequest} — which §3.3 calls an
 * interchangeable expression of the same filter.
 *
 * The `languages` clause is part of the term and so is shown; `raw` is not a
 * term and is not (module header). An unexpressible filter throws here as it
 * does on the wire, so the preview fails where the search would.
 *
 * @param query - the normalized query
 * @param datetype - which date PubMed should match; `"edat"` per §3.3
 * @returns the term, followed by ` AND ("YYYY/MM/DD"[EDAT] : "YYYY/MM/DD"[EDAT])`
 *   when the query carries both bounds
 * @throws RangeError for an unexpressible filter ({@link renderPubmedSearchTerm})
 */
export function explainPubmedQuery(
  query: SourceQuery,
  datetype: PubmedDateType = "edat",
): string {
  const term = renderPubmedSearchTerm(query);
  const window = resolveWindow(query);
  if (window === undefined) return term;

  const tag = datetype === "edat" ? "[EDAT]" : "[PDAT]";
  const range = `("${window.mindate}"${tag} : "${window.maxdate}"${tag})`;
  return term === "" ? range : `${term} AND ${range}`;
}

/** What {@link buildEsearchRequest} is told, beyond the query itself. */
export interface PubmedEsearchOptions {
  /**
   * The normalized query. `terms`, `fromDate`, `toDate`, `languages`,
   * `openAccessOnly` and `raw` are read (module header for the last three).
   */
  readonly query: SourceQuery;
  /** `retmax`; `docs/02` §3.3 caps it at 10 000. `P1-T09` chooses it. */
  readonly retmax: number;
  /** `retstart`; §3.3 caps it at 9998. `P1-T09` clamps and pages. */
  readonly retstart?: number;
  /** `retmode`. `P1-T09` uses `"json"` for `esearch`. */
  readonly retmode?: "json" | "xml";
  /** §3.3's advanced option. Defaults to `"edat"`, never to `"pdat"`. */
  readonly datetype?: PubmedDateType;
  /**
   * NCBI's optional `api_key` (`docs/02` §3.1). Present in
   * {@link PubmedEsearchRequest.url} and **absent** from
   * {@link PubmedEsearchRequest.transmittedUrl}.
   */
  readonly apiKey?: string;
}

/**
 * A built `esearch` request: what to send, and what to store about it.
 *
 * The field names are `docs/07` §5.3's `SourceProvenance` members, so
 * `P1-T17`'s provenance record assigns them across without a second decision
 * about which variant is safe to keep.
 */
export interface PubmedEsearchRequest {
  /** §5.3 `endpointBaseUrl` — the endpoint with no query string. */
  readonly endpointBaseUrl: string;
  /** The query string actually transmitted. May contain `api_key`. */
  readonly queryString: string;
  /** The URL actually transmitted. May contain `api_key`. */
  readonly url: string;
  /** §5.3 `transmittedQuery` — the query string with credentials removed. */
  readonly transmittedQuery: string;
  /** §5.3 `transmittedUrl` — the URL with credentials removed. */
  readonly transmittedUrl: string;
}

/**
 * The parameters, in the order they are emitted. Fixed so that the URL is
 * byte-stable for a given query, which is what `docs/13` §2.2's fixture key —
 * a hash of `{method, url-with-keys-redacted, body}` — depends on. A `Map`
 * insertion order or an object literal would work until someone reordered a
 * field and silently invalidated every recorded fixture.
 */
const PARAM_ORDER = [
  "db",
  "term",
  "retmode",
  "retmax",
  "retstart",
  "datetype",
  "mindate",
  "maxdate",
  "api_key",
  "tool",
  "email",
] as const;

type ParamName = (typeof PARAM_ORDER)[number];

/**
 * Where `SourceQuery.raw`'s pairs go: after this parameter and before the
 * next one in {@link PARAM_ORDER}. After the window and before the credential
 * and the D10 identification — so the fixed prefix of the query string is
 * what it was before `raw` existed and the identification stays last.
 */
const RAW_PARAMS_AFTER: ParamName = "maxdate";

/**
 * `esearch` parameter names `SourceQuery.raw` may not carry.
 *
 * Every name this module emits itself, so `raw` cannot replace or extend the
 * rendered `term` (the parser is not bypassed), displace `tool` / `email`
 * (D10, `docs/02` §3.1 "on **every** request") or smuggle a credential past
 * {@link PubmedEsearchOptions.apiKey}'s redaction path; and `reldate`, because
 * the window is calendar years (conflict C10, module header) and a rolling
 * `reldate` would make the label lie about the same search.
 */
export const RESERVED_RAW_PARAMS: ReadonlySet<string> = new Set<string>([
  ...PARAM_ORDER,
  "reldate",
]);

/**
 * `SourceQuery.raw` as `name=value` pairs, sorted by key, both halves
 * `encodeURIComponent`-ed. Empty when the member is absent or empty.
 *
 * @throws RangeError for a reserved name ({@link RESERVED_RAW_PARAMS}) or an
 *   empty name, which is not a parameter at all
 */
function renderRawParams(raw: SourceQuery["raw"]): readonly string[] {
  if (raw === undefined) return [];
  const names = Object.keys(raw).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return names.map((name) => {
    if (name === "" || RESERVED_RAW_PARAMS.has(name)) {
      throw new RangeError(
        `[research-helper] SourceQuery.raw may not set the PubMed esearch ` +
          `parameter ${JSON.stringify(name)}: it is one this adapter emits ` +
          `itself (term, the D10 tool/email identification, the credential, ` +
          `the date window) and raw never replaces or extends them.`,
      );
    }
    const value = raw[name];
    return `${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`;
  });
}

/**
 * Build the full `esearch` parameter set.
 *
 * Every outbound request carries `tool` and `email` (decision D10, `docs/02`
 * §3.1's "on **every** request", NBK25497's maintainer-address rule), which is
 * why they are added here rather than left to the caller to remember.
 *
 * @param options - the query and the paging/credential parameters `P1-T09` owns
 * @returns the transmitted and the storable forms of the request
 * @throws RangeError when exactly one of `fromDate` / `toDate` is present —
 *   `docs/02` §3.3 marks `mindate` and `maxdate` "both required together", and
 *   inventing the missing bound would silently change the window the user was
 *   shown
 * @throws RangeError when a bound is not `YYYY`, `YYYY-MM` or `YYYY-MM-DD`
 * @throws RangeError for an unexpressible filter, an unrenderable `languages`
 *   list, or a reserved `raw` parameter name (module header)
 */
export function buildEsearchRequest(
  options: PubmedEsearchOptions,
): PubmedEsearchRequest {
  const identity = ncbiIdentityParams();
  const window = resolveWindow(options.query);
  const rawPairs = renderRawParams(options.query.raw);

  const values: Partial<Record<ParamName, string>> = {
    db: "pubmed",
    term: renderPubmedSearchTerm(options.query),
    retmode: options.retmode ?? "json",
    retmax: String(options.retmax),
    retstart: String(options.retstart ?? 0),
    tool: identity.tool,
    email: identity.email,
  };

  if (window !== undefined) {
    values.datetype = options.datetype ?? "edat";
    values.mindate = window.mindate;
    values.maxdate = window.maxdate;
  }
  if (options.apiKey !== undefined && options.apiKey !== "") {
    values.api_key = options.apiKey;
  }

  const queryString = PARAM_ORDER.flatMap((name) => {
    const value = values[name];
    const pair =
      value === undefined ? [] : [`${name}=${encodeURIComponent(value)}`];
    return name === RAW_PARAMS_AFTER ? [...pair, ...rawPairs] : pair;
  }).join("&");

  const url = `${PUBMED_ESEARCH_BASE_URL}?${queryString}`;
  // One redaction, then split it, rather than redacting twice: `redactUrl`
  // rebuilds the URL through `URL`/`URLSearchParams` when it actually removes a
  // parameter, so redacting the bare query string separately would produce a
  // second, differently-encoded string for the same request.
  const transmittedUrl = redactUrl(url);
  const queryStart = transmittedUrl.indexOf("?");

  return {
    endpointBaseUrl: PUBMED_ESEARCH_BASE_URL,
    queryString,
    url,
    transmittedQuery:
      queryStart === -1 ? "" : transmittedUrl.slice(queryStart + 1),
    transmittedUrl,
  };
}

/**
 * The `mindate` / `maxdate` pair for a query, in `docs/02` §3.3's `YYYY/MM/DD`
 * spelling, or `undefined` when the user asked for all years.
 *
 * `SourceQuery.fromDate` / `toDate` are ISO (`docs/07` §4.2), and §3.3 accepts
 * `YYYY/MM/DD`, `YYYY/MM` or `YYYY`, so the conversion is a separator swap at
 * whatever precision arrived. The shipped caller hands over
 * `recencyWindow().fromDate` / `.toDate`, which are always full days.
 */
function resolveWindow(
  query: SourceQuery,
): { mindate: string; maxdate: string } | undefined {
  const { fromDate, toDate } = query;
  if (fromDate === undefined && toDate === undefined) return undefined;
  if (fromDate === undefined || toDate === undefined) {
    throw new RangeError(
      `[research-helper] PubMed needs both date bounds or neither; got ` +
        `fromDate=${JSON.stringify(fromDate)} toDate=${JSON.stringify(toDate)}. ` +
        `docs/02 §3.3 marks mindate and maxdate "both required together".`,
    );
  }
  return { mindate: toEntrezDate(fromDate), maxdate: toEntrezDate(toDate) };
}

const ISO_DATE = /^\d{4}(?:-\d{2}(?:-\d{2})?)?$/u;

function toEntrezDate(iso: string): string {
  if (!ISO_DATE.test(iso)) {
    throw new RangeError(
      `[research-helper] PubMed date bound must be YYYY, YYYY-MM or ` +
        `YYYY-MM-DD; got ${JSON.stringify(iso)}.`,
    );
  }
  return iso.replace(/-/gu, "/");
}
