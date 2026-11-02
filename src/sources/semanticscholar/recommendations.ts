/**
 * Semantic Scholar's Recommendations API requests (`docs/05` §3.1–§3.3).
 *
 * **Scope.** `P5-T04` created this file with the two request builders. `P5-T06`
 * added {@link parseRecommendationsBody}, {@link isResponseTooLarge},
 * {@link RECOMMEND_MAX_POSITIVES} and the small rules beside them. Callers:
 * `semanticscholarSource.ts` (`findRelated`'s `"recommendations"` and
 * `recommend`), and `test/support/semanticscholarRecordedRequests.ts`, which the
 * recorder and the shape tests read. `P5-T29` replaces the cap with a measured
 * figure; `P5-T21` caps its seeds at it.
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

import { BadRequestError, ParseError, redactUrl } from "../../core/errors";
import { SEMANTICSCHOLAR_HOST } from "../../core/rateLimit/hostLimiter";
import type { ExternalIds } from "../../model/ids";

import { parseSemanticScholarJson } from "./graph";
import { SEMANTICSCHOLAR_SOURCE_ID } from "./mapper";
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

/** What a `limit` above §3.3's abstract ceiling asks for. Hydration fills it in. */
export const SEMANTICSCHOLAR_RECOMMEND_FIELDS_NO_ABSTRACT: readonly string[] =
  SEMANTICSCHOLAR_RECOMMEND_FIELDS.filter((field) => field !== "abstract");

/**
 * `docs/05` §3.3 pitfall 2's check: enough to say a seed resolves and to know its
 * other identifiers, for pitfall 4. The order is `batch-unresolvable`'s, whose
 * fixture key depends on it.
 */
export const SEMANTICSCHOLAR_SEED_CHECK_FIELDS: readonly string[] = [
  "paperId",
  "externalIds",
];

/**
 * `docs/05` §3.3's unverified cap, "10–20 positives", at the middle until
 * `P5-T29` probes 10, 20 and 50 and replaces it (`plan/08` §0.4 line 34).
 */
export const RECOMMEND_MAX_POSITIVES = 15;

/**
 * `docs/05` §3.3 and `docs/02` §6.10 quote the size-cap message with an ellipsis,
 * so this opening is all anyone has seen of it, and `docs/13` §3.1 says to match
 * nothing longer.
 */
export const SEMANTICSCHOLAR_RESPONSE_TOO_LARGE_OPENING =
  "Response would exceed maximum size";

/**
 * `limit` as the endpoints take it: a whole number up to §3.3's 500, or 0 for one
 * that asks for nothing, which sends no request.
 *
 * @param limit - the caller's limit
 * @returns 0 … {@link SEMANTICSCHOLAR_RECOMMEND_LIMIT_MAX}
 */
export function clampRecommendLimit(limit: number): number {
  if (!Number.isFinite(limit)) return 0;
  return Math.min(
    SEMANTICSCHOLAR_RECOMMEND_LIMIT_MAX,
    Math.max(0, Math.trunc(limit)),
  );
}

/**
 * The `fields=` list for a limit: `abstract` only at or below §3.3's 100. Chosen
 * once per call, so a retry at half the limit does not start asking for abstracts.
 *
 * @param limit - a limit from {@link clampRecommendLimit}
 * @returns the list {@link buildForPaperRequest} and {@link buildRecommendRequest} accept
 */
export function recommendFieldsFor(limit: number): readonly string[] {
  return limit > SEMANTICSCHOLAR_RECOMMEND_LIMIT_MAX_WITH_ABSTRACT
    ? SEMANTICSCHOLAR_RECOMMEND_FIELDS_NO_ABSTRACT
    : SEMANTICSCHOLAR_RECOMMEND_FIELDS;
}

/**
 * Whether a thrown error is §3.3's 400 for a response over the 10 MB cap. Read off
 * the body the shipped client attaches to a `BadRequestError`.
 *
 * @param error - what a request threw
 * @returns true for a 400 whose body holds {@link SEMANTICSCHOLAR_RESPONSE_TOO_LARGE_OPENING}
 */
export function isResponseTooLarge(error: unknown): boolean {
  return (
    error instanceof BadRequestError &&
    error.httpStatus === 400 &&
    error.body?.includes(SEMANTICSCHOLAR_RESPONSE_TOO_LARGE_OPENING) === true
  );
}

/**
 * One Recommendations body → `recommendedPapers`, unmapped (`docs/05` §3.1). A
 * short or empty list is normal (§3.3 pitfall 1).
 *
 * @param body - the response text
 * @param transmittedUrl - the **redacted** URL, for the thrown error's context
 * @returns the paper objects, the mapper's input
 * @throws SourceError for Semantic Scholar's own error envelope
 * @throws ParseError when the body is not JSON or has no such array
 */
export function parseRecommendationsBody(
  body: string,
  transmittedUrl: string,
): readonly unknown[] {
  const parsed = parseSemanticScholarJson(body, transmittedUrl);
  const papers =
    typeof parsed === "object" && parsed !== null
      ? (parsed as { readonly recommendedPapers?: unknown }).recommendedPapers
      : undefined;
  if (!Array.isArray(papers)) {
    throw new ParseError(
      SEMANTICSCHOLAR_SOURCE_ID,
      `[research-helper] Semantic Scholar Recommendations returned JSON with ` +
        `no recommendedPapers array; docs/05 §3.1 gives that array.`,
      { url: transmittedUrl, bodyLength: body.length },
    );
  }
  return papers as readonly unknown[];
}

/**
 * Every spelling a paper can be recognised by, for §3.3 pitfall 4's filter. Case
 * folded, because a DOI's case is not significant.
 *
 * @param ids - a seed's identifiers, or a candidate's
 * @returns one tagged string per identifier present
 */
export function identifierKeys(ids: Partial<ExternalIds>): readonly string[] {
  return [
    ids.doi === undefined ? undefined : `doi:${ids.doi}`,
    ids.pmid === undefined ? undefined : `pmid:${ids.pmid}`,
    ids.pmcid === undefined ? undefined : `pmcid:${ids.pmcid}`,
    ids.arxivId === undefined ? undefined : `arxiv:${ids.arxivId}`,
    ids.s2CorpusId === undefined ? undefined : `corpus:${ids.s2CorpusId}`,
  ].flatMap((key) => (key === undefined ? [] : [key.toLowerCase()]));
}

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
