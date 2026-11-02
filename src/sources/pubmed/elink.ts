/**
 * PubMed's related-articles request and its answer: `elink` with
 * `cmd=neighbor_score` (`docs/05` §4.2–§4.3, `docs/02` §3.6).
 *
 * **Scope.** `P5-T04` created the request builder and `P5-T08` added the parser
 * and the ranking beside it. Callers: `findSimilarForSeeds` in `pubmedSource.ts`
 * for all three, and `test/support/pubmedRecordedRequests.ts` for the builder,
 * which the recorder and the shape tests read.
 *
 * **`api_key` is optional and goes between the seeds and the identity
 * parameters**, where `esearch` and `efetch` put it. DECIDED 2026-11-02
 * (coordinator, under `plan/00` §6 item 313): the adapter sends it whenever the
 * key store holds one, because `HOST_POLICIES` paces NCBI by the key's presence
 * and an unkeyed request at the keyed pace would run into NCBI's lower limit
 * (`docs/02` §3.1). An unkeyed URL is byte for byte what it was, so the recorded
 * fixture's name still matches; a keyed URL hashes to another name, as it does
 * for `esearch`, and the fixtures stay unkeyed. A log line or a cache key takes
 * {@link PubmedElinkRequest.transmittedUrl}, which has the key removed, and never
 * {@link PubmedElinkRequest.url}.
 *
 * **One `id=` parameter per seed, never a comma-joined list** (`docs/05` §4.3):
 * with `cmd=neighbor_score` a comma-joined list merges the results and loses
 * which seed each neighbour belongs to. Separate parameters give one `linkset`
 * per seed.
 *
 * **The identity parameters are the existing builders'** (`docs/02` §2.2,
 * decision D10): `tool` and `email` come from `ncbiIdentityParams()`, and
 * `createHttpClient` refuses this host anything else.
 *
 * ## Layering
 *
 * `sources/` may import `core/` and `model/` only (`docs/07` §2.3).
 */

import { ParseError, redactUrl, SourceError } from "../../core/errors";
import { ncbiIdentityParams } from "../../core/http/userAgent";
import type { SourceId } from "../../model/ids";

/**
 * The source these errors name. `PUBMED_SOURCE_ID` is the same value, but it
 * lives in `pubmedSource.ts`, which imports this file.
 */
const ELINK_SOURCE_ID: SourceId = "pubmed";

/** `docs/05` §4.2: the endpoint, with no query string. */
export const PUBMED_ELINK_BASE_URL =
  "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/elink.fcgi";

/** `docs/05` §4.3: "always use `neighbor_score`". */
export const PUBMED_ELINK_CMD = "neighbor_score";

/** `docs/02` §3.6: pmra "Related Articles". */
export const PUBMED_ELINK_LINKNAME = "pubmed_pubmed";

/**
 * `docs/05` §7.3's "≤10 seeds". It also bounds the GET's length, since this
 * request has no POST form. No NCBI limit on `id=` parameters is recorded.
 */
export const PUBMED_ELINK_MAX_SEEDS = 10;

/** A built `elink` request. */
export interface PubmedElinkRequest {
  readonly method: "GET";
  readonly url: string;
  /** `redactUrl(url)`. */
  readonly transmittedUrl: string;
  /** The endpoint with no query string. */
  readonly endpointBaseUrl: string;
}

/**
 * Build one `elink` request for `pmids`. Parameter order: `dbfrom`, `db`, `cmd`,
 * `linkname`, `retmode`, one `id` per seed in the order given, `api_key` when
 * there is one, `tool`, `email`.
 *
 * @param pmids - the seeds, digits only, at least one
 * @param apiKey - NCBI's optional `api_key`; omitted when absent or empty
 * @returns the request
 * @throws RangeError for an empty list or an id that is not all digits
 */
export function buildElinkNeighborScoreRequest(
  pmids: readonly string[],
  apiKey?: string,
): PubmedElinkRequest {
  if (pmids.length === 0) {
    throw new RangeError(
      "[research-helper] elink needs at least one PMID (docs/05 §4.2).",
    );
  }
  for (const pmid of pmids) {
    if (!/^\d+$/u.test(pmid)) {
      throw new RangeError(
        `[research-helper] ${JSON.stringify(pmid)} is not a PMID: elink takes ` +
          `one id per parameter, digits only (docs/05 §4.3).`,
      );
    }
  }
  const identity = ncbiIdentityParams();
  const url =
    `${PUBMED_ELINK_BASE_URL}?` +
    [
      "dbfrom=pubmed",
      "db=pubmed",
      `cmd=${PUBMED_ELINK_CMD}`,
      `linkname=${PUBMED_ELINK_LINKNAME}`,
      "retmode=json",
      ...pmids.map((pmid) => `id=${pmid}`),
      ...(apiKey === undefined || apiKey === ""
        ? []
        : [`api_key=${encodeURIComponent(apiKey)}`]),
      `tool=${encodeURIComponent(identity.tool)}`,
      `email=${encodeURIComponent(identity.email)}`,
    ].join("&");
  return {
    method: "GET",
    url,
    transmittedUrl: redactUrl(url),
    endpointBaseUrl: PUBMED_ELINK_BASE_URL,
  };
}

/** One neighbour as `elink` lists it. `score` is positive and unnormalised. */
export interface PubmedElinkLink {
  readonly pmid: string;
  readonly score: number;
}

/** One seed's list, in the order `elink` sent it. */
export interface PubmedElinkLinkset {
  readonly seedPmid: string;
  readonly links: readonly PubmedElinkLink[];
  /** Entries left out for having no digit id or no positive score. */
  readonly malformedLinks: number;
}

/**
 * Read one `elink` JSON body into one list per seed.
 *
 * A seed comes from its linkset's own `ids`, never from the linkset's position.
 * A linkset that does not name exactly one seed throws, because attribution is
 * what the separate `id=` parameters exist for (`docs/05` §4.3).
 *
 * **Recorded on 2026-11-02:** the envelope, one `ids` entry per linkset, one
 * `linksetdbs` entry, and numeric scores. **Never observed, so written from the
 * other E-utilities' habits:** the top-level `ERROR` (`docs/02` §3.8 records it
 * for `esearch` only) and a linkset with no `pubmed_pubmed` entry, read here as
 * a seed with no neighbours.
 *
 * @param body - the response text, `retmode=json`
 * @param transmittedUrl - the **redacted** URL, for the thrown error's context
 * @returns the lists, in the order of the response
 * @throws SourceError when the body carries a top-level `ERROR`
 * @throws ParseError when the body is not the documented shape
 */
export function parseElinkNeighborScoreBody(
  body: string,
  transmittedUrl: string,
): readonly PubmedElinkLinkset[] {
  const malformed = (what: string, cause?: unknown): ParseError =>
    new ParseError(
      ELINK_SOURCE_ID,
      `[research-helper] PubMed elink returned ${what}; docs/05 §4.2 gives the shape.`,
      { url: transmittedUrl, bodyLength: body.length },
      cause === undefined ? undefined : { cause },
    );

  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch (cause) {
    throw malformed("a body that is not JSON", cause);
  }
  const envelope = asRecord(parsed);
  if (envelope === undefined) throw malformed("JSON that is not an object");

  const upstream = envelope.ERROR;
  if (upstream !== undefined && upstream !== null) {
    const text =
      typeof upstream === "string" ? upstream : JSON.stringify(upstream);
    throw new SourceError(
      ELINK_SOURCE_ID,
      `[research-helper] PubMed elink failed inside an HTTP 200: ${text}`,
      { url: transmittedUrl, upstreamError: text },
    );
  }

  const { linksets } = envelope;
  if (!Array.isArray(linksets)) throw malformed("JSON with no linksets array");

  return linksets.map((entry: unknown) => {
    const linkset = asRecord(entry);
    const ids = linkset?.ids;
    const seedPmid = Array.isArray(ids) ? (ids[0] as unknown) : undefined;
    if (
      linkset === undefined ||
      !Array.isArray(ids) ||
      ids.length !== 1 ||
      typeof seedPmid !== "string"
    ) {
      throw malformed("a linkset that does not name exactly one seed");
    }
    return { seedPmid, ...readLinks(linkset.linksetdbs) };
  });
}

/** The `pubmed_pubmed` entry's links, counting the ones that cannot be used. */
function readLinks(
  linksetdbs: unknown,
): Pick<PubmedElinkLinkset, "links" | "malformedLinks"> {
  const entries: readonly unknown[] = Array.isArray(linksetdbs)
    ? linksetdbs
    : [];
  const entry = entries
    .map((candidate) => asRecord(candidate))
    .find((candidate) => candidate?.linkname === PUBMED_ELINK_LINKNAME);
  const raw: readonly unknown[] = Array.isArray(entry?.links)
    ? entry.links
    : [];

  const links: PubmedElinkLink[] = [];
  for (const candidate of raw) {
    const link = asRecord(candidate);
    const pmid = link?.id;
    const score = link?.score;
    if (
      typeof pmid === "string" &&
      /^\d+$/u.test(pmid) &&
      typeof score === "number" &&
      Number.isFinite(score) &&
      score > 0
    ) {
      links.push({ pmid, score });
    }
  }
  return { links, malformedLinks: raw.length - links.length };
}

/** One neighbour after {@link rankElinkLinkset}. */
export interface PubmedSimilarNeighbour {
  readonly pmid: string;
  /** 1-based position in the seed's list once the seed itself is dropped. */
  readonly rank: number;
  /** The raw score over the list's maximum, in (0, 1]. */
  readonly score: number;
}

/** What {@link rankElinkLinkset} returns. */
export interface PubmedRankedLinkset {
  /** The list's length once the seed is dropped, before the slice. */
  readonly listLength: number;
  /** The first `limit` neighbours. */
  readonly neighbours: readonly PubmedSimilarNeighbour[];
}

/**
 * Drop the seed, normalise, slice, in that order (`docs/05` §4.3). Scores are
 * compared within this one list only. The order is `elink`'s own, which the
 * recording shows descending by score; it is not re-sorted, because `rank` is
 * "position in this source's own list" (`docs/07` §4.2).
 *
 * @param linkset - one seed's list
 * @param limit - how many neighbours to keep, a non-negative integer
 * @returns the survivors and the length of the list they were cut from
 */
export function rankElinkLinkset(
  linkset: PubmedElinkLinkset,
  limit: number,
): PubmedRankedLinkset {
  const seen = new Set<string>([linkset.seedPmid]);
  const others = linkset.links.filter((link) => {
    if (seen.has(link.pmid)) return false;
    seen.add(link.pmid);
    return true;
  });
  const max = others.reduce((top, link) => Math.max(top, link.score), 0);
  return {
    listLength: others.length,
    neighbours: others.slice(0, limit).map((link, index) => ({
      pmid: link.pmid,
      rank: index + 1,
      score: link.score / max,
    })),
  };
}

/** `{...}` and not `null`, `[]` or a primitive. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
