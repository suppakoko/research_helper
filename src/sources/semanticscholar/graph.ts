/**
 * Semantic Scholar's relation requests: references, citations and the title
 * match (`docs/05` §2.1, `docs/02` §6.2).
 *
 * **Scope.** `P5-T04` created this file with the three request builders only:
 * address and body, no parser and no adapter method. Callers today:
 * `test/support/semanticscholarRecordedRequests.ts`, which the recorder and the
 * shape tests read. `P5-T05` adds the parsers beside these builders and is the
 * product caller, through `semanticscholarSource.ts`.
 *
 * **Why the builders came before the adapter** (`plan/08` §0.4 line 32): a
 * fixture is found by the exact method, URL and body (`fixtureKey`), so the
 * request the recorder sends and the request the adapter will send have to be
 * one declaration before anything is recorded.
 *
 * **What the requests carry.** Never a credential: the key travels as the
 * `x-api-key` header (`docs/02` §6.4), which is the adapter's business and is
 * outside the fixture key. `transmittedUrl` still goes through `redactUrl`, so
 * the invariant is mechanical, as in `./query.ts`.
 *
 * **`contexts` on both lists.** DECIDED 2026-11-02 (coordinator, under plan/00
 * §6 item 313): `docs/05` §2.1's table gives `contexts`, `intents` and
 * `isInfluential` for the citation graph as a whole and `P5-T04` step 1 names
 * them for both endpoints, while `P5-T05` step 1 asks for them "for citations".
 * Both requests ask, so the recorded references answer shows whether the
 * service fills them, and no second recording is needed if it does.
 *
 * ## Layering
 *
 * `sources/` may import `core/` and `model/` only (`docs/07` §2.3). Nothing
 * here names the `Zotero` global, reads a preference or touches a file.
 */

import { redactUrl } from "../../core/errors";

import {
  encodePaperId,
  SEMANTICSCHOLAR_BULK_FIELDS,
  SEMANTICSCHOLAR_PAPER_URL,
  SEMANTICSCHOLAR_RELEVANCE_SEARCH_URL,
  type SemanticScholarRequest,
} from "./query";

/** `docs/02` §6.2: the single best title match. */
export const SEMANTICSCHOLAR_TITLE_MATCH_URL = `${SEMANTICSCHOLAR_RELEVANCE_SEARCH_URL}/match`;

/** `docs/02` §6.2, `docs/05` §2.1: both lists take `limit ≤ 1000`. */
export const SEMANTICSCHOLAR_RELATION_LIMIT_MAX = 1000;

/** `docs/05` §2.1: the edge's own members, which no other source has. */
export const SEMANTICSCHOLAR_RELATION_EDGE_FIELDS: readonly string[] = [
  "contexts",
  "intents",
  "isInfluential",
];

/** `docs/05` §2.1's worked request, in its order: the edge, then the paper. */
export const SEMANTICSCHOLAR_RELATION_FIELDS: readonly string[] = [
  ...SEMANTICSCHOLAR_RELATION_EDGE_FIELDS,
  "title",
  "year",
  "externalIds",
  "citationCount",
];

/**
 * What a title match asks for: every field `./mapper.ts` reads that
 * `/paper/search/bulk` also serves, because `docs/02` records no response from
 * this endpoint and `tldr` is the one field measured refused elsewhere
 * (2026-10-15, `./query.ts`).
 */
export const SEMANTICSCHOLAR_TITLE_MATCH_FIELDS: readonly string[] =
  SEMANTICSCHOLAR_BULK_FIELDS;

/** What {@link buildReferencesRequest} and {@link buildCitationsRequest} take. */
export interface SemanticScholarRelationOptions {
  /** Any `docs/02` §6.3 id form: `DOI:…`, `PMID:…`, `ARXIV:…`, a bare SHA. */
  readonly paperId: string;
  /** The page size, 1 … {@link SEMANTICSCHOLAR_RELATION_LIMIT_MAX}. */
  readonly limit: number;
  /** The 0-based offset. Absent or `0` sends no parameter. */
  readonly offset?: number;
  /** The `fields=` list. Defaults to {@link SEMANTICSCHOLAR_RELATION_FIELDS}. */
  readonly fields?: readonly string[];
}

function pair(name: string, value: string): string {
  return `${encodeURIComponent(name)}=${encodeURIComponent(value)}`;
}

/** One relation list. Parameter order is fixed: `fields`, `limit`, `offset`. */
function buildRelationRequest(
  relation: "references" | "citations",
  options: SemanticScholarRelationOptions,
): SemanticScholarRequest {
  const { paperId, limit, offset = 0 } = options;
  if (paperId.trim() === "") {
    throw new RangeError(
      `[research-helper] /paper/{id}/${relation} needs a paper id (docs/02 §6.3).`,
    );
  }
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > SEMANTICSCHOLAR_RELATION_LIMIT_MAX
  ) {
    throw new RangeError(
      `[research-helper] Semantic Scholar /${relation} takes limit 1 … ` +
        `${String(SEMANTICSCHOLAR_RELATION_LIMIT_MAX)} (docs/02 §6.2); got ` +
        `${String(limit)}.`,
    );
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new RangeError(
      `[research-helper] Semantic Scholar /${relation} needs a whole, ` +
        `non-negative offset; got ${String(offset)}.`,
    );
  }
  const fields = options.fields ?? SEMANTICSCHOLAR_RELATION_FIELDS;
  const parts = [
    pair("fields", fields.join(",")),
    pair("limit", String(limit)),
  ];
  if (offset > 0) parts.push(pair("offset", String(offset)));
  const url =
    `${SEMANTICSCHOLAR_PAPER_URL}/${encodePaperId(paperId)}/${relation}?` +
    parts.join("&");
  return {
    method: "GET",
    url,
    transmittedUrl: redactUrl(url),
    endpointBaseUrl: `${SEMANTICSCHOLAR_PAPER_URL}/{paper_id}/${relation}`,
  };
}

/**
 * `GET /paper/{id}/references` (`docs/02` §6.2).
 *
 * @param options - the seed and the page
 * @returns the request
 * @throws RangeError for a blank id, or a `limit` or `offset` out of range
 */
export function buildReferencesRequest(
  options: SemanticScholarRelationOptions,
): SemanticScholarRequest {
  return buildRelationRequest("references", options);
}

/**
 * `GET /paper/{id}/citations` (`docs/02` §6.2), with `docs/05` §2.1's `contexts`.
 *
 * @param options - the seed and the page
 * @returns the request
 * @throws RangeError for a blank id, or a `limit` or `offset` out of range
 */
export function buildCitationsRequest(
  options: SemanticScholarRelationOptions,
): SemanticScholarRequest {
  return buildRelationRequest("citations", options);
}

/**
 * `GET /paper/search/match` (`docs/02` §6.2). Parameter order: `query`, `fields`.
 *
 * The title goes as typed, after trimming: `docs/02` §6.5's "hyphenated terms
 * yield no matches" is recorded for `/paper/search`, not for this endpoint, so
 * nothing here assumes it.
 *
 * @param title - the title to match
 * @param fields - the `fields=` list; defaults to
 *   {@link SEMANTICSCHOLAR_TITLE_MATCH_FIELDS}
 * @returns the request
 * @throws RangeError for a blank title
 */
export function buildTitleMatchRequest(
  title: string,
  fields: readonly string[] = SEMANTICSCHOLAR_TITLE_MATCH_FIELDS,
): SemanticScholarRequest {
  const query = title.trim();
  if (query === "") {
    throw new RangeError(
      "[research-helper] /paper/search/match needs a title (docs/02 §6.2).",
    );
  }
  const url =
    `${SEMANTICSCHOLAR_TITLE_MATCH_URL}?` +
    [pair("query", query), pair("fields", fields.join(","))].join("&");
  return {
    method: "GET",
    url,
    transmittedUrl: redactUrl(url),
    endpointBaseUrl: SEMANTICSCHOLAR_TITLE_MATCH_URL,
  };
}
