/**
 * The PMCID route of Strategy B: PMCIDs in, the DOI or PMID each one resolves
 * to out, through the NCBI ID Converter (`docs/02` §3.7).
 *
 * **Scope.** Owner's decision of 2026-10-19 (`plan/00` §6 item 214): a record
 * whose only identifier is a PMCID is resolved through the converter before
 * `src/zotero/translatorImport.ts` looks it up, because `setIdentifier` does
 * not accept a PMCID (`docs/01` §6.2). {@link createPmcidConverter} returns a
 * function shaped exactly like that module's `PmcidResolver`; the writer in
 * `src/bootstrap/registerPipelines.ts` builds it over the shipped HTTP client
 * and hands it to Strategy B as `resolvePmcids`. A PMCID the converter does
 * not resolve is simply absent from the returned map, and the importer then
 * hand-maps that record without a lookup.
 *
 * ## Why it lives here
 *
 * The converter is an NCBI service, so it sits beside the PubMed adapter. It
 * is not a `LiteratureSource` (it searches nothing and returns no records),
 * and `docs/07` §2.3 lets `sources/` import only `core/` and `model/` — which
 * is why the resolver's type is restated structurally here rather than
 * imported from `src/zotero/`. The composition side (`bootstrap/`) joins the
 * two.
 *
 * ## The request, from `docs/02` §3.7
 *
 * - Base URL `https://pmc.ncbi.nlm.nih.gov/tools/idconv/api/v1/articles/`
 *   (the classic `www.ncbi.nlm.nih.gov/pmc/utils/idconv/v1.0/` URL redirects).
 * - `idtype=pmcid` **always**: the new endpoint no longer detects the id type,
 *   and a request without it reads every value as a PMID and answers 400.
 * - `format=json`, then `tool` and `email` — the maintainer's, from
 *   `src/core/http/userAgent.ts`'s `ncbiIdentityParams()`, never a user's
 *   (decision D10; `docs/02` §2.2's NCBI exception).
 * - **No API key, ever** (owner, item 214). Nothing here takes a secret store,
 *   so there is no key to send.
 * - **Batched, {@link IDCONV_MAX_IDS_PER_REQUEST} ids to a request.** §3.7
 *   gives 200 as the batch limit "documented historically" and says to
 *   "re-confirm before relying on >100"; 100 is the largest batch the
 *   document supports without that re-confirmation.
 * - Every request goes through the injected `HttpClient`
 *   (`src/core/http/client.ts`), so the `pmc.ncbi.nlm.nih.gov` bucket of
 *   `docs/07` §7.3, the `User-Agent` and the client's redaction all apply.
 *
 * ## The response
 *
 * `{"status":"ok","records":[{"doi":…,"pmcid":…,"pmid":<number>,
 * "requested-id":…}]}` (§3.7's verified example). A record is matched to the
 * PMCID it answers by `requested-id`, falling back to `pmcid`; a record with
 * neither a DOI nor a PMID, or one carrying its own `status: "error"`, resolves
 * nothing. A body that is not that envelope throws `ParseError`; an envelope
 * whose `status` is `"error"` throws `SourceError` with the upstream message —
 * the resolver's caller logs either and hand-maps the records.
 */

import type { CancellationToken } from "../../core/jobQueue/cancellation";
import { ParseError, SourceError } from "../../core/errors";
import type { HttpClient } from "../../core/http/client";
import { ncbiIdentityParams } from "../../core/http/userAgent";
import type { Logger } from "../../core/logger";
import { PMC_IDCONV_HOST } from "../../core/rateLimit/hostLimiter";
import { normalizePmcid } from "../../model/ids";
import { PUBMED_SOURCE_ID } from "./pubmedSource";

/** `docs/02` §3.7's new base URL, on the host §7.3's row paces. */
export const NCBI_IDCONV_BASE_URL = `https://${PMC_IDCONV_HOST}/tools/idconv/api/v1/articles/`;

/**
 * PMCIDs per converter request. `docs/02` §3.7: "Batch limit is **200 IDs per
 * request** (documented historically; re-confirm before relying on >100)".
 */
export const IDCONV_MAX_IDS_PER_REQUEST = 100;

/** A PMCID's other identifiers, as the converter reports them. */
export interface ConvertedPmcid {
  readonly doi?: string;
  readonly pmid?: string;
}

/**
 * PMCIDs in, the identifiers each resolved to out. Structurally
 * `src/zotero/translatorImport.ts`'s `PmcidResolver`; a PMCID absent from the
 * map did not resolve.
 */
export type PmcidConverter = (
  pmcids: readonly string[],
  token: CancellationToken | undefined,
) => Promise<ReadonlyMap<string, ConvertedPmcid>>;

/** What {@link createPmcidConverter} needs. */
export interface PmcidConverterDeps {
  /** The shipped client — pacing, `User-Agent` and redaction come with it. */
  readonly http: HttpClient;
  /** Diagnostics: counts and status only, never a body. */
  readonly logger?: Logger;
}

/** One record of the converter's answer, after validation. */
export interface IdConverterRecord {
  /** `requested-id`, else `pmcid` — the id this record answers. */
  readonly requestedId: string;
  readonly doi?: string;
  readonly pmid?: string;
}

/**
 * The converter URL for one batch, in §3.7's parameter order.
 *
 * @param pmcids - 1 to {@link IDCONV_MAX_IDS_PER_REQUEST} PMCIDs
 * @throws RangeError for an empty batch or an oversized one
 */
export function buildIdConverterUrl(pmcids: readonly string[]): string {
  if (pmcids.length === 0) {
    throw new RangeError(
      "[research-helper] the ID Converter needs at least one PMCID",
    );
  }
  if (pmcids.length > IDCONV_MAX_IDS_PER_REQUEST) {
    throw new RangeError(
      `[research-helper] the ID Converter takes at most ` +
        `${String(IDCONV_MAX_IDS_PER_REQUEST)} ids per request here ` +
        `(docs/02 §3.7); got ${String(pmcids.length)}.`,
    );
  }
  const identity = ncbiIdentityParams();
  const params: readonly (readonly [string, string])[] = [
    ["ids", pmcids.join(",")],
    ["idtype", "pmcid"],
    ["format", "json"],
    ["tool", identity.tool],
    ["email", identity.email],
  ];
  const query = params
    .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
    .join("&");
  return `${NCBI_IDCONV_BASE_URL}?${query}`;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? undefined : trimmed;
  }
  return undefined;
}

/** `pmid` arrives as a number in §3.7's example; a digit string is accepted. */
function pmidOf(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return String(value);
  }
  const text = nonEmptyString(value);
  return text !== undefined && /^\d+$/u.test(text) ? text : undefined;
}

/**
 * Parse one converter answer.
 *
 * @param body - the response text, `format=json`
 * @param url - the request URL, for the thrown error's context (it carries
 *   no key: the converter is never sent one)
 * @throws ParseError when the body is not JSON or has no `records` array
 * @throws SourceError when the envelope's `status` is `"error"`
 */
export function parseIdConverterBody(
  body: string,
  url: string,
): readonly IdConverterRecord[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch (cause) {
    throw new ParseError(
      PUBMED_SOURCE_ID,
      "[research-helper] the NCBI ID Converter returned a body that is not " +
        "JSON (docs/02 §3.7).",
      { url, bodyLength: body.length },
      { cause },
    );
  }
  const envelope = asRecord(parsed);
  if (envelope === undefined) {
    throw new ParseError(
      PUBMED_SOURCE_ID,
      "[research-helper] the NCBI ID Converter returned JSON that is not an " +
        "object.",
      { url, bodyLength: body.length },
    );
  }
  if (envelope.status === "error") {
    const errors = Array.isArray(envelope.errors) ? envelope.errors : [];
    const first = asRecord(errors[0]);
    const message = nonEmptyString(first?.message) ?? "no message";
    throw new SourceError(
      PUBMED_SOURCE_ID,
      `[research-helper] the NCBI ID Converter refused the request: ${message}`,
      {
        url,
        upstreamError: message,
        ...(nonEmptyString(first?.code) !== undefined && {
          upstreamCode: nonEmptyString(first?.code),
        }),
      },
    );
  }
  const records = envelope.records;
  if (!Array.isArray(records)) {
    throw new ParseError(
      PUBMED_SOURCE_ID,
      "[research-helper] the NCBI ID Converter returned JSON with no " +
        "`records` array; docs/02 §3.7 gives that array as the answer.",
      { url, bodyLength: body.length },
    );
  }
  const out: IdConverterRecord[] = [];
  for (const entry of records) {
    const record = asRecord(entry);
    if (record === undefined || record.status === "error") continue;
    const requestedId =
      nonEmptyString(record["requested-id"]) ?? nonEmptyString(record.pmcid);
    if (requestedId === undefined) continue;
    const doi = nonEmptyString(record.doi);
    const pmid = pmidOf(record.pmid);
    if (doi === undefined && pmid === undefined) continue;
    out.push({
      requestedId,
      ...(doi !== undefined && { doi }),
      ...(pmid !== undefined && { pmid }),
    });
  }
  return out;
}

/**
 * Build the PMCID route over the shipped client.
 *
 * Ids are normalized with `model/ids.ts`'s `normalizePmcid` before they are
 * sent — one malformed value would otherwise make NCBI refuse the whole batch
 * (§3.7's `invalid_pmids` answer) — and each answer is mapped back to every
 * spelling the caller asked with. An id that does not normalize is never
 * sent and never resolves. Batches go out one after another; the host's
 * bucket paces them, and the token is checked before each.
 */
export function createPmcidConverter(deps: PmcidConverterDeps): PmcidConverter {
  const { http, logger } = deps;
  return async (pmcids, token) => {
    // Normalized id → every spelling the caller used for it.
    const asked = new Map<string, string[]>();
    for (const raw of pmcids) {
      const normalized = normalizePmcid(raw);
      if (normalized === null) continue;
      const spellings = asked.get(normalized) ?? [];
      if (!spellings.includes(raw)) spellings.push(raw);
      asked.set(normalized, spellings);
    }
    const resolved = new Map<string, ConvertedPmcid>();
    const ids = [...asked.keys()];
    for (
      let start = 0;
      start < ids.length;
      start += IDCONV_MAX_IDS_PER_REQUEST
    ) {
      token?.throwIfCancelled();
      const batch = ids.slice(start, start + IDCONV_MAX_IDS_PER_REQUEST);
      const url = buildIdConverterUrl(batch);
      const response = await http.request("GET", url, {
        responseType: "text",
        ...(token !== undefined && { token }),
      });
      const records = parseIdConverterBody(response.body, url);
      let hits = 0;
      for (const record of records) {
        const normalized = normalizePmcid(record.requestedId);
        const spellings =
          normalized === null ? undefined : asked.get(normalized);
        if (spellings === undefined) continue;
        const value: ConvertedPmcid = {
          ...(record.doi !== undefined && { doi: record.doi }),
          ...(record.pmid !== undefined && { pmid: record.pmid }),
        };
        for (const spelling of spellings) resolved.set(spelling, value);
        hits += 1;
      }
      logger?.debug("pmcid route: ID Converter batch", {
        host: PMC_IDCONV_HOST,
        asked: batch.length,
        resolved: hits,
        status: response.status,
      });
    }
    return resolved;
  };
}
