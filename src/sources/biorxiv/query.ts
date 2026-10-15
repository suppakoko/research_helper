/**
 * bioRxiv / medRxiv request building: the two DOI-scoped calls this adapter
 * makes, and the honest "no query" rendering the UI previews.
 *
 * **Scope.** `P2-T07` steps 3 and 4. The bioRxiv API has **no keyword
 * search** (`docs/02` §8.4, "the fatal limitation"), so nothing here renders a
 * {@link QueryNode}: `docs/02` §12.2's bioRxiv block is "**Not applicable** —
 * the translator should not emit a bioRxiv query at all; route preprint search
 * to Europe PMC `SRC:PPR`". What this module builds instead is:
 *
 * - `/details/{server}/{DOI}/na/json` — metadata, with the abstract, for a
 *   *known* preprint DOI (`docs/02` §8.2, §8.4's routing table row "Metadata
 *   for a known preprint DOI"). One request per DOI: the endpoint takes one.
 * - `/pubs/{server}/{DOI}/na/json` — the preprint→published cross-walk for one
 *   DOI (§8.3, §8.4's row "Preprint → published version link"). §8.2's table
 *   writes the DOI form of `/pubs/` with a `{format}` segment; §8.5's
 *   2026-09-15 measurement notes the *interval* template omits it. Only the DOI
 *   form is built here, with `json`.
 *
 * The interval and cursor forms (`/details/{server}/{interval}/{cursor}`) are
 * **not** built: a client-side sweep over a date window is the card's first
 * Do NOT ("~2,000 requests / 35 minutes … not a viable interactive feature").
 *
 * ## Which DOIs are worth a request
 *
 * {@link biorxivLookupDoi} accepts a DOI only when its registrant prefix is one
 * of `src/sources/shared/dedupe.ts`'s `BIORXIV_ACCESSION_PREFIXES` —
 * `10.1101/` (legacy) **and** `10.64898/` (current, `docs/02` §11.2, verified
 * 2026-09-08). That is a question of *where a DOI can possibly resolve*, not of
 * *which server minted it*: both prefixes are live on both servers (§11.2,
 * "medRxiv uses `10.64898/` too"), so the prefix is never used to choose
 * between `biorxiv` and `medrxiv` — the record's own `server` field does that
 * (`./mapper.ts`). No single-prefix test anywhere: a set, both prefixes
 * (the card's second Do NOT).
 *
 * ## Layering
 *
 * `sources/` may import `core/` and `model/` only (`docs/07` §2.3), plus the
 * sibling `shared/` modules. No key, no contact parameter: `docs/02` §8.1 —
 * "No key, no cost"; the client's `User-Agent` is the only identity sent.
 */

import type { HttpMethod } from "../../core/http/client";
import { BIORXIV_HOST } from "../../core/rateLimit/hostLimiter";
import { normalizeDoi, type Doi } from "../../model/ids";
import { biorxivAccession } from "../shared/dedupe";

// ---------------------------------------------------------------------------
// 1. Constants — `docs/02` §8.1 / §8.2
// ---------------------------------------------------------------------------

/** `docs/02` §8.1: `https://api.biorxiv.org`. */
export const BIORXIV_API_BASE_URL = `https://${BIORXIV_HOST}`;

/**
 * `docs/02` §8.2: "`{server}` ∈ `biorxiv`, `medrxiv`". Also the two
 * `SourceId`s this adapter registers under — `docs/07` §5.1's union spells
 * them identically, which is what lets `./mapper.ts` turn a record's `server`
 * field straight into a `SourceId`.
 */
export type BiorxivServer = "biorxiv" | "medrxiv";

/** Both servers, in `SOURCE_IDS` order. */
export const BIORXIV_SERVERS: readonly BiorxivServer[] = ["biorxiv", "medrxiv"];

/** The two endpoints this adapter calls (`docs/02` §8.2). */
export type BiorxivEndpoint = "details" | "pubs";

/**
 * `docs/02` §8.2's page sizes: `/details/` returns **30**, `/pubs/` 100. A
 * DOI lookup is one page; the constant is what `SourceCapabilities.maxPageSize`
 * declares, so the planner never budgets `/details/` as if it returned 100
 * (the card's sixth Do NOT).
 */
export const BIORXIV_DETAILS_PAGE_SIZE = 30;
export const BIORXIV_PUBS_PAGE_SIZE = 100;

/** `docs/02` §8.2: the cursor segment of the DOI form is the literal `na`. */
export const BIORXIV_DOI_CURSOR = "na";

/** `docs/02` §8.2's `{format}`: JSON. */
export const BIORXIV_FORMAT = "json";

/**
 * Where keyword search of preprints actually happens (`docs/02` §8.4's
 * routing table, first row; §4.5). Named in the page warning and in
 * {@link explainBiorxivQuery}.
 */
export const BIORXIV_PREPRINT_SEARCH_ROUTE = "Europe PMC SRC:PPR";

/**
 * The characters a DOI may carry into a `/details/` or `/pubs/` path. bioRxiv
 * and medRxiv DOIs are digits and dots after the prefix (`10.64898/2026.07.31.741992`,
 * the old-style `10.1101/459891`); anything else is refused rather than
 * percent-encoded, because §8.2 documents no encoding for that segment and a
 * DOI that needs one cannot be a bioRxiv accession.
 */
const PATH_SAFE_DOI = /^10\.\d{4,9}\/[0-9a-z._-]+$/u;

// ---------------------------------------------------------------------------
// 2. Which DOIs
// ---------------------------------------------------------------------------

/**
 * A DOI this host can possibly answer for, normalized; `undefined` otherwise.
 *
 * @param raw - a DOI as a caller holds it (any spelling `normalizeDoi` accepts)
 * @returns the normalized DOI when it is syntactic, its prefix is one of the
 *   two bioRxiv/medRxiv registrant prefixes (`docs/02` §11.2) and it is
 *   path-safe; `undefined` for anything else — which is "not this host's", not
 *   an error
 */
export function biorxivLookupDoi(
  raw: string | null | undefined,
): Doi | undefined {
  const doi = normalizeDoi(raw);
  if (doi === null) return undefined;
  if (biorxivAccession(doi) === undefined) return undefined;
  return PATH_SAFE_DOI.test(doi) ? doi : undefined;
}

// ---------------------------------------------------------------------------
// 3. The requests
// ---------------------------------------------------------------------------

/** One DOI-scoped request, in the shape the other adapters' builders return. */
export interface BiorxivRequest {
  /** Always `"GET"`: `docs/02` §8 documents no POST form. */
  readonly method: HttpMethod;
  /** The URL actually transmitted. */
  readonly url: string;
  /**
   * §5.3 `transmittedUrl`. Identical to {@link url}: there is no key and no
   * contact parameter on this host (`docs/02` §8.1).
   */
  readonly transmittedUrl: string;
  /** §5.3 `endpointBaseUrl`: the endpoint and server, without the DOI. */
  readonly endpointBaseUrl: string;
  readonly endpoint: BiorxivEndpoint;
  readonly server: BiorxivServer;
  readonly doi: Doi;
}

/**
 * Build `/{endpoint}/{server}/{DOI}/na/json`.
 *
 * @throws RangeError when `doi` is not one {@link biorxivLookupDoi} accepts —
 *   a caller that skipped the filter has a bug, and a malformed path segment
 *   must not reach the host
 */
function buildDoiRequest(
  endpoint: BiorxivEndpoint,
  server: BiorxivServer,
  doi: string,
): BiorxivRequest {
  const accepted = biorxivLookupDoi(doi);
  if (accepted === undefined) {
    throw new RangeError(
      `[research-helper] ${JSON.stringify(doi)} is not a bioRxiv/medRxiv DOI ` +
        `(registrant prefix 10.1101/ or 10.64898/, docs/02 §11.2); ` +
        `api.biorxiv.org cannot answer for it.`,
    );
  }
  const endpointBaseUrl = `${BIORXIV_API_BASE_URL}/${endpoint}/${server}`;
  const url = `${endpointBaseUrl}/${accepted}/${BIORXIV_DOI_CURSOR}/${BIORXIV_FORMAT}`;
  return {
    method: "GET",
    url,
    transmittedUrl: url,
    endpointBaseUrl,
    endpoint,
    server,
    doi: accepted,
  };
}

/**
 * `GET /details/{server}/{DOI}/na/json` — `docs/02` §8.2's DOI form.
 *
 * @param server - the server to ask
 * @param doi - a DOI {@link biorxivLookupDoi} accepts
 */
export function buildBiorxivDetailsRequest(
  server: BiorxivServer,
  doi: string,
): BiorxivRequest {
  return buildDoiRequest("details", server, doi);
}

/**
 * `GET /pubs/{server}/{DOI}/na/json` — the cross-walk (`docs/02` §8.3).
 *
 * @param server - the server to ask
 * @param doi - a DOI {@link biorxivLookupDoi} accepts
 */
export function buildBiorxivPubsRequest(
  server: BiorxivServer,
  doi: string,
): BiorxivRequest {
  return buildDoiRequest("pubs", server, doi);
}

// ---------------------------------------------------------------------------
// 4. explainQuery
// ---------------------------------------------------------------------------

/** The display spelling of each server (`docs/02` §10.3's `repository` values). */
export const BIORXIV_SERVER_LABELS: Readonly<Record<BiorxivServer, string>> = {
  biorxiv: "bioRxiv",
  medrxiv: "medRxiv",
};

/**
 * `LiteratureSource.explainQuery` for a source that sends no query. `docs/02`
 * §12.2: "The translator should not emit a bioRxiv query at all". The string
 * is what the provenance record's `transmittedQuery` and the UI preview show,
 * so it says that nothing was sent and where the search went instead, rather
 * than being empty (an empty preview reads as a bug).
 *
 * @param server - the adapter's server
 * @returns a fixed, query-independent notice
 */
export function explainBiorxivQuery(server: BiorxivServer): string {
  return (
    `(no query sent: ${BIORXIV_SERVER_LABELS[server]} has no keyword search — ` +
    `preprint keyword search runs through ${BIORXIV_PREPRINT_SEARCH_ROUTE})`
  );
}
