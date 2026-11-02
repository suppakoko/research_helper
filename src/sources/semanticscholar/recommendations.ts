/**
 * Semantic Scholar's Recommendations API requests (`docs/05` §3.1–§3.3).
 *
 * **Scope.** `P5-T04` created this file with the two request builders only:
 * address and body, no parser and no adapter method. Callers today:
 * `test/support/semanticscholarRecordedRequests.ts`, which the recorder and the
 * shape tests read. `P5-T06` adds the parsers and `RECOMMEND_MAX_POSITIVES`
 * beside these builders and is the product caller, through
 * `semanticscholarSource.ts`.
 *
 * **`from=recent` is not a parameter of the builder** (`docs/05` §3.2's
 * decision): `all-cs` is off-brief, restricted to computer science, and cannot
 * be sent from here by accident.
 *
 * **The fields are the verified list.** {@link SEMANTICSCHOLAR_RECOMMEND_FIELDS}
 * is `docs/05` §3.1's worked request and nothing more, because a recording of
 * this endpoint costs the owner a session (`P5-T31`) and a refused field would
 * cost another. A caller that needs more hydrates through `/paper/batch`.
 *
 * **What the requests carry.** Never a credential: the key is the `x-api-key`
 * header (`docs/02` §6.4), outside the fixture key, and the adapter's business.
 *
 * ## Layering
 *
 * `sources/` may import `core/` and `model/` only (`docs/07` §2.3).
 */

import { redactUrl } from "../../core/errors";
import { SEMANTICSCHOLAR_HOST } from "../../core/rateLimit/hostLimiter";

import { encodePaperId, type SemanticScholarRequest } from "./query";

/** `docs/05` §3: the Recommendations base. */
export const SEMANTICSCHOLAR_RECOMMENDATIONS_BASE_URL = `https://${SEMANTICSCHOLAR_HOST}/recommendations/v1`;

/** `docs/05` §3.1: one seed; `/{paper_id}` is appended. */
export const SEMANTICSCHOLAR_FORPAPER_URL = `${SEMANTICSCHOLAR_RECOMMENDATIONS_BASE_URL}/papers/forpaper`;

/** `docs/05` §3.1: positive and negative seeds. The trailing slash is the spec's. */
export const SEMANTICSCHOLAR_RECOMMEND_URL = `${SEMANTICSCHOLAR_RECOMMENDATIONS_BASE_URL}/papers/`;

/** `docs/05` §3.2's decision. */
export const SEMANTICSCHOLAR_RECOMMEND_FROM = "recent";

/** `docs/05` §3.3: the largest `limit` the endpoints take. */
export const SEMANTICSCHOLAR_RECOMMEND_LIMIT_MAX = 500;

/** `docs/05` §3.3: with `abstract` requested, stay under the 10 MB response cap. */
export const SEMANTICSCHOLAR_RECOMMEND_LIMIT_MAX_WITH_ABSTRACT = 100;

/** `docs/05` §3.1's worked request. */
export const SEMANTICSCHOLAR_RECOMMEND_FIELDS: readonly string[] = [
  "title",
  "year",
  "externalIds",
  "venue",
  "citationCount",
  "abstract",
];

/** What both builders share. */
export interface SemanticScholarRecommendPage {
  /** The most recommendations wanted; a shorter answer is normal (§3.3). */
  readonly limit: number;
  /** The `fields=` list. Defaults to {@link SEMANTICSCHOLAR_RECOMMEND_FIELDS}. */
  readonly fields?: readonly string[];
}

/** What {@link buildForPaperRequest} takes. */
export interface SemanticScholarForPaperOptions extends SemanticScholarRecommendPage {
  /** Any `docs/02` §6.3 id form. */
  readonly paperId: string;
}

/** What {@link buildRecommendRequest} takes. */
export interface SemanticScholarRecommendOptions extends SemanticScholarRecommendPage {
  /** At least one. Validate them through `/paper/batch` first: §3.3 pitfall 2. */
  readonly positivePaperIds: readonly string[];
  /** May be empty. */
  readonly negativePaperIds: readonly string[];
}

/** A `POST /papers/` request. */
export interface SemanticScholarRecommendRequest extends SemanticScholarRequest {
  readonly method: "POST";
  readonly body: string;
  readonly contentType: "application/json";
}

function pair(name: string, value: string): string {
  return `${encodeURIComponent(name)}=${encodeURIComponent(value)}`;
}

/** `limit` inside §3.3's ceiling for what `fields` asks for. */
function assertLimit(limit: number, fields: readonly string[]): void {
  const max = fields.includes("abstract")
    ? SEMANTICSCHOLAR_RECOMMEND_LIMIT_MAX_WITH_ABSTRACT
    : SEMANTICSCHOLAR_RECOMMEND_LIMIT_MAX;
  if (!Number.isInteger(limit) || limit < 1 || limit > max) {
    throw new RangeError(
      `[research-helper] Semantic Scholar Recommendations take limit 1 … ` +
        `${String(max)} with these fields (docs/05 §3.3); got ${String(limit)}.`,
    );
  }
}

/**
 * `GET /papers/forpaper/{id}?from=recent` (`docs/05` §3.1). Parameter order:
 * `from`, `limit`, `fields`.
 *
 * @param options - the seed, the limit and the fields
 * @returns the request
 * @throws RangeError for a blank id or a `limit` over §3.3's ceiling
 */
export function buildForPaperRequest(
  options: SemanticScholarForPaperOptions,
): SemanticScholarRequest {
  const fields = options.fields ?? SEMANTICSCHOLAR_RECOMMEND_FIELDS;
  if (options.paperId.trim() === "") {
    throw new RangeError(
      "[research-helper] /papers/forpaper needs a paper id (docs/05 §3.1).",
    );
  }
  assertLimit(options.limit, fields);
  const url =
    `${SEMANTICSCHOLAR_FORPAPER_URL}/${encodePaperId(options.paperId)}?` +
    [
      pair("from", SEMANTICSCHOLAR_RECOMMEND_FROM),
      pair("limit", String(options.limit)),
      pair("fields", fields.join(",")),
    ].join("&");
  return {
    method: "GET",
    url,
    transmittedUrl: redactUrl(url),
    endpointBaseUrl: `${SEMANTICSCHOLAR_FORPAPER_URL}/{paper_id}`,
  };
}

/**
 * `POST /papers/` (`docs/05` §3.1): `limit` and `fields` as **query parameters**
 * ("a common mistake" otherwise), the ids in the JSON body with the positives
 * first. The body's bytes are fixed, because `fixtureKey` hashes them.
 *
 * @param options - the seeds, the limit and the fields
 * @returns the request
 * @throws RangeError for no positive id or a `limit` over §3.3's ceiling
 */
export function buildRecommendRequest(
  options: SemanticScholarRecommendOptions,
): SemanticScholarRecommendRequest {
  const fields = options.fields ?? SEMANTICSCHOLAR_RECOMMEND_FIELDS;
  if (options.positivePaperIds.length === 0) {
    throw new RangeError(
      "[research-helper] POST /papers/ needs at least one positive paper id " +
        "(docs/05 §3.1).",
    );
  }
  assertLimit(options.limit, fields);
  const url =
    `${SEMANTICSCHOLAR_RECOMMEND_URL}?` +
    [
      pair("limit", String(options.limit)),
      pair("fields", fields.join(",")),
    ].join("&");
  return {
    method: "POST",
    url,
    transmittedUrl: redactUrl(url),
    endpointBaseUrl: SEMANTICSCHOLAR_RECOMMEND_URL,
    body: JSON.stringify({
      positivePaperIds: options.positivePaperIds,
      negativePaperIds: options.negativePaperIds,
    }),
    contentType: "application/json",
  };
}
