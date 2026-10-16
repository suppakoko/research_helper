/**
 * The DOIs the committed bioRxiv and medRxiv fixtures were recorded under — the
 * one declaration `scripts/record-fixtures.ts` and
 * `test/unit/sources/biorxiv.test.ts` both import (`P2-T07`, the layout
 * `pubmedRecordedRequests.ts` prescribes and the other adapters' support files
 * follow).
 *
 * A fixture is keyed on the exact URL (`fixtureKey` in `fixtureReplay.ts`), so
 * every consumer must build the same request. {@link recordedBiorxivRequest}
 * is the shipped builder itself (`buildBiorxivDetailsRequest` /
 * `buildBiorxivPubsRequest` in `src/sources/biorxiv/query.ts`); the adapter's
 * `lookup()` and `resolvePublished()` call exactly those. There is no key and
 * no contact parameter on `api.biorxiv.org`, so nothing about identity is in
 * the URL. Change a DOI here and its fixture must be re-recorded; a drift shows
 * up as "Missing fixture" in the unit test, never as a network call.
 *
 * **Why DOIs and not queries.** The bioRxiv API has no keyword search
 * (`docs/02` §8.4), so `docs/13` §3.1's `search-typical`, `search-single` and
 * `paginated` rows have nothing to record on this host, and `dedup-pair-set`
 * is the cross-source set `P2-T08` assembles (`plan/00` §6 item 168). Every
 * live scenario is one DOI-scoped call at the `api.biorxiv.org` row's 1/s.
 *
 * **Where each DOI comes from** — none was looked up for this file, so no
 * request was spent choosing them:
 * - `10.1101/2025.09.17.676679` (YeastSAM → *Mol Biol Cell*) and
 *   `10.64898/2026.07.31.741992` are `docs/02` §8.3's own `/pubs/` and
 *   `/details/` samples;
 * - `10.1101/2023.03.22.533184` ("Schrödinger’s Cat in Simulations…") is a
 *   bioRxiv paper in the committed Semantic Scholar fixtures;
 * - `10.1101/459891` (LIGER, Welch et al.) is cited by DOI in a committed
 *   PubMed fixture — an old-style, pre-2019 bioRxiv DOI with no date in it;
 * - `10.64898/2026.09.02.26361916` and `10.64898/2026.09.03.26361736` are
 *   `docs/02` §11.2's medRxiv examples (the first was this card's one probe);
 * - `10.1101/2020.04.14.20062463` (Bendavid et al., Santa Clara seroprevalence)
 *   is a widely cited legacy-prefix medRxiv preprint with a published version.
 *
 * No platform import, so an integration spec inside Zotero can read it too.
 */

import {
  buildBiorxivDetailsRequest,
  buildBiorxivPubsRequest,
  type BiorxivEndpoint,
  type BiorxivRequest,
  type BiorxivServer,
} from "../../src/sources/biorxiv/query";

// ---------------------------------------------------------------------------
// bioRxiv
// ---------------------------------------------------------------------------

/** `record-rich` (`/details/`) and `record-preprint` (`/pubs/`): legacy prefix, published. */
export const BIORXIV_DOI_RICH = "10.1101/2025.09.17.676679";

/** `record-sparse` and `pubs-not-found`: current prefix, `published: "NA"` (§8.3). */
export const BIORXIV_DOI_SPARSE = "10.64898/2026.07.31.741992";

/** `record-unicode`: an `ö` and a `’` in the title. */
export const BIORXIV_DOI_UNICODE = "10.1101/2023.03.22.533184";

/** `pubs-old-style-doi` (`/pubs/`): the old-style, dateless DOI form; LIGER, published in *Cell*. */
export const BIORXIV_DOI_OLD_STYLE = "10.1101/459891";

/**
 * `lookup-cross-server`: a **medRxiv** DOI asked of the bioRxiv server — does
 * the host answer across servers, and with which `server`?
 */
export const BIORXIV_DOI_CROSS_SERVER = "10.64898/2026.09.02.26361916";

// ---------------------------------------------------------------------------
// medRxiv
// ---------------------------------------------------------------------------

/** `record-rich` (`/details/`) and `record-preprint` (`/pubs/`): legacy prefix, published. */
export const MEDRXIV_DOI_RICH = "10.1101/2020.04.14.20062463";

/** `record-sparse`: current prefix, a September 2026 posting (`docs/02` §11.2). */
export const MEDRXIV_DOI_SPARSE = "10.64898/2026.09.03.26361736";

// ---------------------------------------------------------------------------
// P2-T13 Part B: the deduplication corpus's lookups
// ---------------------------------------------------------------------------

/**
 * Preprint DOIs the `P2-T13` Part B corpus searches returned
 * (`dedupCorpusRecordedRequests.ts`), looked up on `/details/` so that each
 * preprint is also in the corpus as bioRxiv or medRxiv itself returns it — a
 * pair with every other source's record of it, and through the `published`
 * field a link to its journal version. Read from the recorded search
 * fixtures' DOIs on 2026-10-16, not chosen by hand.
 *
 * **Which server.** Europe PMC names it (`bookOrReportDetails.publisher`).
 * Crossref names only `openRxiv` for both, so a Crossref-only DOI is assigned
 * by its accession: medRxiv accessions carry eight digits after the date
 * (`24314505`), bioRxiv's six (`599202`) — `docs/02` §11.2's own examples
 * follow that rule. The prefix never decides it (§11.2).
 */
export const BIORXIV_CORPUS_DOIS: readonly string[] = [
  "10.1101/2024.06.16.599202", // Crossref corpus-q2
  "10.1101/2024.07.14.603469", // Crossref corpus-q2
  "10.1101/2024.10.29.620871", // Europe PMC corpus-q2
];

/** As {@link BIORXIV_CORPUS_DOIS}, for medRxiv. */
export const MEDRXIV_CORPUS_DOIS: readonly string[] = [
  "10.1101/2021.10.19.21265219", // Europe PMC corpus-q5
  "10.1101/2021.12.02.21266871", // Europe PMC corpus-q5
  "10.1101/2021.12.28.21268451", // Europe PMC corpus-q5
  "10.1101/2024.09.27.24314505", // Crossref corpus-q3
  "10.1101/2024.10.31.24316386", // Crossref and Europe PMC corpus-q3
  "10.1101/2024.12.10.24317471", // Europe PMC corpus-q2
];

/** A corpus lookup's scenario name: `corpus-doi-<accession>`. */
export function corpusLookupScenario(doi: string): string {
  return `corpus-doi-${doi.slice(doi.indexOf("/") + 1)}`;
}

// ---------------------------------------------------------------------------
// Both
// ---------------------------------------------------------------------------

/**
 * `search-empty`: a syntactically valid current-prefix DOI dated 1999, before
 * either server existed, so it cannot resolve. `docs/13` §3.1's "zero results"
 * row, as a DOI lookup expresses it.
 */
export const BIORXIV_DOI_ABSENT = "10.64898/1999.01.01.000000";

/**
 * The DOIs the hand-written fixtures are keyed under. Never requested: each
 * names its scenario so a reader of the sidecar cannot mistake it for a real
 * accession. All five are current-prefix shapes the builder accepts.
 */
export const BIORXIV_DOI_SYNTHETIC_429 = "10.64898/0000.04.29.000429";
export const BIORXIV_DOI_SYNTHETIC_500 = "10.64898/0000.05.00.000500";
export const BIORXIV_DOI_SYNTHETIC_MALFORMED = "10.64898/0000.00.00.000001";
export const BIORXIV_DOI_SYNTHETIC_EMPTY_BODY = "10.64898/0000.00.00.000002";
export const BIORXIV_DOI_SYNTHETIC_STATUS_ERROR = "10.64898/0000.00.00.000003";

/**
 * The request a scenario was recorded under — the shipped builder's, so the
 * fixture key is the one the adapter's own call hashes to.
 *
 * @param endpoint - `details` or `pubs`
 * @param server - `biorxiv` or `medrxiv`
 * @param doi - one of the DOIs above
 */
export function recordedBiorxivRequest(
  endpoint: BiorxivEndpoint,
  server: BiorxivServer,
  doi: string,
): BiorxivRequest {
  return endpoint === "details"
    ? buildBiorxivDetailsRequest(server, doi)
    : buildBiorxivPubsRequest(server, doi);
}
