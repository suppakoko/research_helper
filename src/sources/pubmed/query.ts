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
import type { QueryField, QueryNode, SourceQuery } from "../types";

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
  const cleaned = value.replace(ENTREZ_SYNTAX_CHARS, " ").trim();
  if (cleaned === "") return "";
  const collapsed = cleaned.replace(/\s+/gu, " ");
  const tag = FIELD_TAGS[field ?? "any"];
  const quoted = phrase || !BARE_VALUE.test(collapsed);
  return quoted ? `"${collapsed}"${tag}` : `${collapsed}${tag}`;
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
 * @param query - the normalized query
 * @param datetype - which date PubMed should match; `"edat"` per §3.3
 * @returns the term, followed by ` AND ("YYYY/MM/DD"[EDAT] : "YYYY/MM/DD"[EDAT])`
 *   when the query carries both bounds
 */
export function explainPubmedQuery(
  query: SourceQuery,
  datetype: PubmedDateType = "edat",
): string {
  const term = renderPubmedTerm(query.terms);
  const window = resolveWindow(query);
  if (window === undefined) return term;

  const tag = datetype === "edat" ? "[EDAT]" : "[PDAT]";
  const range = `("${window.mindate}"${tag} : "${window.maxdate}"${tag})`;
  return term === "" ? range : `${term} AND ${range}`;
}

/** What {@link buildEsearchRequest} is told, beyond the query itself. */
export interface PubmedEsearchOptions {
  /** The normalized query. `terms`, `fromDate` and `toDate` are read. */
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
 */
export function buildEsearchRequest(
  options: PubmedEsearchOptions,
): PubmedEsearchRequest {
  const identity = ncbiIdentityParams();
  const window = resolveWindow(options.query);

  const values: Partial<Record<(typeof PARAM_ORDER)[number], string>> = {
    db: "pubmed",
    term: renderPubmedTerm(options.query.terms),
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
    return value === undefined ? [] : [`${name}=${encodeURIComponent(value)}`];
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
