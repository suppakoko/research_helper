/**
 * Preprint servers, the DOI prefixes they mint under, and which server a
 * record came from — `docs/02-literature-database-apis.md` §11.2.
 *
 * **Scope.** `P2-T08`. This module owns `docs/02` §11.2's prefix **set**;
 * `./dedupe.ts` declared it first (`P2-T09` ran before this file existed) and
 * now imports it from here and re-exports it, so there is one declaration and
 * every existing importer keeps working.
 *
 * **The server is named by the record's server/publisher field, never by its
 * DOI prefix.** §11.2, verified 2026-09-09: medRxiv mints under `10.64898/`
 * as bioRxiv does, so "the prefix does not distinguish bioRxiv from medRxiv —
 * use the publisher/server field, never the DOI prefix, for server
 * detection". {@link detectServer} therefore decides from the field alone and
 * reports the prefix only as {@link ServerDetection.doiCorroborates}, a weak
 * signal no caller may turn into a server name.
 *
 * **Layering.** `sources/` imports `core/` and `model/` only (`docs/07`
 * §2.3); this file imports nothing at all, which is what lets
 * `src/zotero/itemMapper.ts` use it for `docs/07` §6.2's `repository`.
 */

// ---------------------------------------------------------------------------
// 1. The servers — docs/02 §11.2's five, spelled as docs/02 §10.3 spells them
// ---------------------------------------------------------------------------

/**
 * The preprint servers `docs/02` §11.2's prefix set names ("bioRxiv-legacy,
 * bioRxiv/medRxiv-current, arXiv, Research Square, SSRN") — the same five as
 * §10.2's Semantic Scholar `venue` trigger. Each member is the spelling
 * written into Zotero's `repository` (`docs/02` §10.3: `"bioRxiv"`,
 * `"arXiv"`, `"medRxiv"`).
 */
export type PreprintServer =
  "bioRxiv" | "medRxiv" | "arXiv" | "Research Square" | "SSRN";

/**
 * Field spellings that name a server, compared after trimming and
 * lower-casing. Each server's own name, plus `arxiv.org` — the spelling
 * Semantic Scholar's live `venue` uses (measured; the same alias
 * `src/sources/semanticscholar/mapper.ts`'s preprint-venue set accepts).
 *
 * A publisher that is an organisation rather than a server is deliberately
 * **not** here: `openRxiv` runs both bioRxiv and medRxiv and so names
 * neither, and `Research Square Platform LLC` (a Crossref `publisher`) is a
 * company name the corpus does not equate with the server.
 */
const SERVER_BY_FIELD: ReadonlyMap<string, PreprintServer> = new Map([
  ["biorxiv", "bioRxiv"],
  ["medrxiv", "medRxiv"],
  ["arxiv", "arXiv"],
  ["arxiv.org", "arXiv"],
  ["research square", "Research Square"],
  ["ssrn", "SSRN"],
]);

// ---------------------------------------------------------------------------
// 2. The DOI prefixes — docs/02 §11.2
// ---------------------------------------------------------------------------

/**
 * `docs/02` §11.2's prefix set, each prefix with the servers that mint under
 * it. `10.1101/` and `10.64898/` are both live on both bioRxiv and medRxiv
 * (§11.2: "medRxiv uses `10.64898/` too"; `10.1101/2020.04.14.20062463` is a
 * medRxiv DOI the bioRxiv mapper was measured against), which is exactly why
 * the prefix cannot name the server.
 */
export const PREPRINT_DOI_PREFIX_SERVERS: ReadonlyMap<
  string,
  readonly PreprintServer[]
> = new Map<string, readonly PreprintServer[]>([
  ["10.1101/", ["bioRxiv", "medRxiv"]],
  ["10.64898/", ["bioRxiv", "medRxiv"]],
  ["10.48550/", ["arXiv"]],
  ["10.21203/", ["Research Square"]],
  ["10.2139/", ["SSRN"]],
]);

/**
 * `docs/02` §11.2's prefix set: bioRxiv-legacy, bioRxiv/medRxiv-current,
 * arXiv, Research Square, SSRN. Membership is a weak corroborating signal
 * only; server detection is {@link detectServer}'s job.
 */
export const PREPRINT_DOI_PREFIXES: ReadonlySet<string> = new Set(
  PREPRINT_DOI_PREFIX_SERVERS.keys(),
);

/**
 * The two prefixes under which bioRxiv and medRxiv mint the *same* accession
 * (`docs/02` §11.2 implication 2: the suffix is the stable accession across
 * both). A DOI pair sharing a suffix under these prefixes is the secondary
 * key of `./dedupe.ts`'s Tier 0.
 *
 * Derived from {@link PREPRINT_DOI_PREFIX_SERVERS} rather than listed, so the
 * bioRxiv half of the set cannot diverge from the set itself.
 */
export const BIORXIV_ACCESSION_PREFIXES: ReadonlySet<string> = new Set(
  [...PREPRINT_DOI_PREFIX_SERVERS]
    .filter(([, servers]) => servers.includes("bioRxiv"))
    .map(([prefix]) => prefix),
);

/** The registrant prefix of a normalized DOI, slash included: `"10.1101/"`. */
export function doiPrefix(doi: string): string {
  return doi.slice(0, doi.indexOf("/") + 1);
}

/** Is `doi`'s prefix in the §11.2 preprint set? A hint, not a server id. */
export function isPreprintDoi(doi: string): boolean {
  return PREPRINT_DOI_PREFIXES.has(doiPrefix(doi));
}

// ---------------------------------------------------------------------------
// 3. Server detection
// ---------------------------------------------------------------------------

/**
 * What {@link detectServer} reads. Source-neutral on purpose: every source
 * mapper already puts its server field into `CanonicalWork.containerTitle`
 * (Europe PMC `bookOrReportDetails.publisher`, bioRxiv `server`, arXiv the
 * literal `arXiv`, Semantic Scholar `journal.name` ‖ `venue`, Crossref
 * `institution` ‖ `publisher`), so a caller holding a work passes
 * `[containerTitle, publisher]`.
 */
export interface ServerEvidence {
  /**
   * The record's server/publisher fields, most specific first. The first one
   * that names a known server decides; `undefined` and blank entries are
   * skipped.
   */
  readonly serverFields: readonly (string | undefined)[];
  /** The record's normalized DOI, when it has one. Corroboration only. */
  readonly doi?: string | undefined;
}

/** A server named by a record's field, and what its DOI prefix says about it. */
export interface ServerDetection {
  readonly server: PreprintServer;
  /**
   * `true` when the DOI's prefix is one the server mints under, `false` when
   * the DOI has a different prefix, `undefined` when there is no DOI. Never
   * changes {@link server}: a disagreeing prefix is reported, not obeyed.
   */
  readonly doiCorroborates: boolean | undefined;
}

/**
 * Which preprint server a record came from (`P2-T08` step 1).
 *
 * The publisher/server field is the only input that can name the server.
 * The DOI prefix is consulted afterwards, and only to say whether it agrees:
 * a `10.64898/` DOI is returned as `medRxiv` when the field says medRxiv and
 * as `bioRxiv` when the field says bioRxiv, and a record whose field names no
 * known server gets `undefined` whatever its DOI.
 *
 * @param evidence - the server/publisher fields and the DOI
 * @returns the server and the prefix's agreement, or `undefined` when no
 *   field names one of the five servers
 */
export function detectServer(
  evidence: ServerEvidence,
): ServerDetection | undefined {
  let server: PreprintServer | undefined;
  for (const field of evidence.serverFields) {
    const key = field?.trim().toLowerCase() ?? "";
    if (key === "") continue;
    server = SERVER_BY_FIELD.get(key);
    if (server !== undefined) break;
  }
  if (server === undefined) return undefined;
  const doi = evidence.doi?.trim() ?? "";
  const doiCorroborates =
    doi === ""
      ? undefined
      : (PREPRINT_DOI_PREFIX_SERVERS.get(doiPrefix(doi))?.includes(server) ??
        false);
  return { server, doiCorroborates };
}
