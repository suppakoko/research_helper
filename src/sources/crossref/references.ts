/**
 * Crossref's requests for related-paper work: one work by DOI, for its deposited
 * `reference[]`, and a title search (`docs/05` §2.1, `docs/02` §5.2).
 *
 * **Scope.** `P5-T04` created this file with the two request builders.
 * `P5-T09` added {@link parseCrossrefReferences} and
 * {@link parseCrossrefEnvelope} beside them. Callers: `crossrefSource.ts`
 * (`findRelated`, `matchTitle`, `parseCrossrefWorksBody`), and
 * `test/support/crossrefRecordedRequests.ts`, which the recorder and the shape
 * tests read. A title search's answer is an ordinary `/works` page, so it has
 * no parser here: `crossrefSource.ts`'s `parseCrossrefWorksBody` reads it.
 *
 * **A reference's record holds its DOI and nothing else (`P5-T09`, DECIDED
 * 2026-11-02, coordinator, under `plan/00` §6 item 313).** `docs/02` §5.3 records
 * what an entry carries: `unstructured` is a citation string, not a title;
 * `author` is one spelling such as `CV Theodoris`, not a family name;
 * `journal-title` can be an abbreviation. Crossref leads `PRECEDENCE`'s venue and
 * title rows in `src/model/merge.ts`, so any of them would outrank a better value
 * once the record merges. The record's `missingFields` say what filling it in
 * must supply, and `unstructured` is never read, which is why the one
 * `[redacted:42]` in the recorded `work-with-references` cannot reach a record.
 *
 * **Why neither is `./query.ts`'s `buildCrossrefWorksRequest`.** That builder
 * always sends `sort`, `order` and `cursor`, for a paged keyword search. `P2-T04`
 * measured the same title search without a cursor already returning the paper
 * first (2026-10-15, `CROSSREF_SORT` in `./query.ts`), and a title search here
 * takes one page of at most {@link CROSSREF_TITLE_SEARCH_ROWS_MAX}.
 *
 * **`query.bibliographic` is not a resolver** (`docs/02` §5.2, measured
 * 2026-10-15): a bare DOI there returned three unrelated records, so
 * {@link buildCrossrefTitleSearchRequest} refuses one.
 *
 * **Identification.** `mailto` is the user's `contactEmail` when set and the
 * maintainer's otherwise, as on every Crossref request (`crossrefContactParams`,
 * decision D10). It stays the last parameter, as in `./query.ts`.
 *
 * ## Layering
 *
 * `sources/` may import `core/` and `model/` only (`docs/07` §2.3).
 */

import { ParseError, redactUrl, SourceError } from "../../core/errors";
import { crossrefContactParams } from "../../core/http/userAgent";
import { normalizeDoi, type Doi } from "../../model/ids";
import type { RelationEdge } from "../../model/related";
import type { SourceRecord } from "../../model/sourceRecord";

import { CROSSREF_MAPPABLE_FIELDS, CROSSREF_SOURCE_ID } from "./mapper";
import { CROSSREF_SELECT_FIELDS, CROSSREF_WORKS_URL } from "./query";

/** `P5-T09` step 2: a title search wants a few candidates, not a page. */
export const CROSSREF_TITLE_SEARCH_ROWS_MAX = 5;

/** A DOI as `docs/02` §5 uses it: the `10.` prefix, a registrant, a slash, a suffix. */
const DOI_SHAPE = /^10\.\d{4,9}\/\S+$/u;

/** A built request: what to send, and what a sidecar may store about it. */
export interface CrossrefRelatedRequest {
  readonly method: "GET";
  readonly url: string;
  /** `redactUrl(url)`. */
  readonly transmittedUrl: string;
  /** The endpoint with its DOI as a placeholder and no query string. */
  readonly endpointBaseUrl: string;
}

/**
 * `GET /works/{doi}` (`docs/02` §5.1's single-DOI route). No `select`: this is
 * the one record, and `reference[]` is what it is fetched for. The DOI is
 * percent-encoded whole, its slash included.
 *
 * @param doi - the DOI, without a resolver prefix
 * @param userContactEmail - the `contactEmail` preference's value, if any
 * @returns the request
 * @throws RangeError for anything that is not DOI-shaped
 */
export function buildCrossrefWorkRequest(
  doi: string,
  userContactEmail?: string,
): CrossrefRelatedRequest {
  if (!DOI_SHAPE.test(doi)) {
    throw new RangeError(
      `[research-helper] ${JSON.stringify(doi)} is not a DOI (docs/02 §5.2).`,
    );
  }
  const { mailto } = crossrefContactParams(userContactEmail);
  const url =
    `${CROSSREF_WORKS_URL}/${encodeURIComponent(doi)}?` +
    `mailto=${encodeURIComponent(mailto)}`;
  return {
    method: "GET",
    url,
    transmittedUrl: redactUrl(url),
    endpointBaseUrl: `${CROSSREF_WORKS_URL}/{doi}`,
  };
}

/** What {@link buildCrossrefTitleSearchRequest} takes. */
export interface CrossrefTitleSearchOptions {
  readonly title: string;
  /** 1 … {@link CROSSREF_TITLE_SEARCH_ROWS_MAX}. */
  readonly rows: number;
  /** The `contactEmail` preference's value, if any. */
  readonly userContactEmail?: string | undefined;
}

/**
 * `GET /works?query.bibliographic=…`. Parameter order: `query.bibliographic`,
 * `select`, `rows`, `mailto`, which is `./query.ts`'s order without the paging.
 *
 * @param options - the title and the number of candidates
 * @returns the request
 * @throws RangeError for a blank title, a DOI given as the title (bare or in any
 *   form `normalizeDoi` reads, such as a resolver address), or `rows` out of range
 */
export function buildCrossrefTitleSearchRequest(
  options: CrossrefTitleSearchOptions,
): CrossrefRelatedRequest {
  const title = options.title.trim();
  if (title === "") {
    throw new RangeError(
      "[research-helper] a Crossref title search needs a title.",
    );
  }
  if (normalizeDoi(title) !== null) {
    throw new RangeError(
      "[research-helper] query.bibliographic is not a DOI resolver (docs/02 " +
        "§5.2); look a DOI up with buildCrossrefWorkRequest.",
    );
  }
  const { rows } = options;
  if (
    !Number.isInteger(rows) ||
    rows < 1 ||
    rows > CROSSREF_TITLE_SEARCH_ROWS_MAX
  ) {
    throw new RangeError(
      `[research-helper] a Crossref title search takes rows 1 … ` +
        `${String(CROSSREF_TITLE_SEARCH_ROWS_MAX)}; got ${String(rows)}.`,
    );
  }
  const { mailto } = crossrefContactParams(options.userContactEmail);
  const url =
    `${CROSSREF_WORKS_URL}?` +
    [
      `query.bibliographic=${encodeURIComponent(title)}`,
      `select=${encodeURIComponent(CROSSREF_SELECT_FIELDS.join(","))}`,
      `rows=${String(rows)}`,
      `mailto=${encodeURIComponent(mailto)}`,
    ].join("&");
  return {
    method: "GET",
    url,
    transmittedUrl: redactUrl(url),
    endpointBaseUrl: CROSSREF_WORKS_URL,
  };
}

/** `{...}` and not `null`, `[]` or a primitive. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/**
 * The envelope every Crossref body shares (`docs/02` §5.3), read once for
 * `/works` and `/works/{doi}` alike.
 *
 * @param body - the response text
 * @param transmittedUrl - the **redacted** URL, for the thrown error's context
 * @returns the parsed envelope, whose `status` is `"ok"`
 * @throws SourceError when `status` is not `"ok"` — Crossref's own error
 *   envelope, `{"status":"error","message-type":"validation-failure",…}`
 * @throws ParseError when the body is not JSON or not a JSON object
 */
export function parseCrossrefEnvelope(
  body: string,
  transmittedUrl: string,
): Readonly<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch (cause) {
    throw new ParseError(
      CROSSREF_SOURCE_ID,
      `[research-helper] Crossref returned a body that is not JSON.`,
      { url: transmittedUrl, bodyLength: body.length },
      { cause },
    );
  }
  const envelope = asRecord(parsed);
  if (envelope === undefined) {
    throw new ParseError(
      CROSSREF_SOURCE_ID,
      `[research-helper] Crossref returned JSON that is not an object.`,
      { url: transmittedUrl, bodyLength: body.length },
    );
  }

  if (envelope.status !== "ok") {
    const upstream = envelope.message;
    const text =
      typeof upstream === "string" ? upstream : JSON.stringify(upstream);
    throw new SourceError(
      CROSSREF_SOURCE_ID,
      `[research-helper] Crossref answered status ${JSON.stringify(envelope.status)} ` +
        `(${String(envelope["message-type"])}): ${text}`,
      {
        url: transmittedUrl,
        status: envelope.status,
        messageType: envelope["message-type"],
        upstreamError: text,
      },
    );
  }
  return envelope;
}

/** A work's deposited reference list, read for `findRelated`. */
export interface CrossrefReferenceList {
  /** How many entries `reference[]` holds; 0 when the member is absent. */
  readonly deposited: number;
  /** How many of them were dropped for having no usable DOI. */
  readonly withoutDoi: number;
  /** One minimal record per distinct DOI, in the list's order. */
  readonly records: readonly SourceRecord[];
  /** `edges[i]` describes `records[i]`, as `RelatedPage` requires. */
  readonly edges: readonly RelationEdge[];
}

/** What a reference's record leaves for filling in: all but its DOI. */
const REFERENCE_MISSING_FIELDS: readonly string[] =
  CROSSREF_MAPPABLE_FIELDS.filter((field) => field !== "ids.doi");

/** The module header says why a reference's record holds only this. */
function referenceRecord(doi: Doi, retrievedAtEpochMs: number): SourceRecord {
  return {
    id: `${CROSSREF_SOURCE_ID}:${doi}`,
    sourceId: CROSSREF_SOURCE_ID,
    nativeId: doi,
    work: { ids: { doi }, type: "other", title: "", authors: [] },
    retrievedAtEpochMs,
    missingFields: REFERENCE_MISSING_FIELDS,
  };
}

/**
 * One `/works/{doi}` body → its deposited references, as records and edges of
 * kind `"reference"` (the seed cites the record; `docs/07` §4.2).
 *
 * `rank` is the entry's 1-based position in `reference[]`, counting the entries
 * dropped for having no DOI, so it stays the list's own numbering (`docs/07`
 * §4.2 as built by `P5-T09`). A DOI listed twice keeps its first position:
 * `SourceRecord.id` is unique across the plugin. A work with no `reference`
 * member is a normal answer (`docs/05` §2.1) and yields an empty list.
 *
 * @param body - the response text
 * @param transmittedUrl - the **redacted** URL, for the thrown error's context
 * @param retrievedAtEpochMs - stamped on every record
 * @returns the list; the caller slices it to its limit
 * @throws SourceError for Crossref's own error envelope
 * @throws ParseError when the body is not JSON, is not a single work (a
 *   `work-list` must not read as "no references"), or has a `reference` member
 *   that is not an array
 */
export function parseCrossrefReferences(
  body: string,
  transmittedUrl: string,
  retrievedAtEpochMs: number,
): CrossrefReferenceList {
  const envelope = parseCrossrefEnvelope(body, transmittedUrl);
  const message = asRecord(envelope.message);
  if (envelope["message-type"] !== "work" || message === undefined) {
    throw new ParseError(
      CROSSREF_SOURCE_ID,
      `[research-helper] Crossref /works/{doi} returned ` +
        `${JSON.stringify(envelope["message-type"])}, not a single work ` +
        `(docs/02 §5.3).`,
      { url: transmittedUrl, bodyLength: body.length },
    );
  }

  const reference = message.reference;
  if (reference === undefined) {
    return { deposited: 0, withoutDoi: 0, records: [], edges: [] };
  }
  if (!Array.isArray(reference)) {
    throw new ParseError(
      CROSSREF_SOURCE_ID,
      `[research-helper] Crossref /works/{doi} returned a reference member ` +
        `that is not an array (docs/02 §5.3).`,
      { url: transmittedUrl, bodyLength: body.length },
    );
  }

  const entries = reference as readonly unknown[];
  const records: SourceRecord[] = [];
  const edges: RelationEdge[] = [];
  const seen = new Set<Doi>();
  let withoutDoi = 0;
  entries.forEach((entry, index) => {
    const raw = asRecord(entry)?.DOI;
    const doi = typeof raw === "string" ? normalizeDoi(raw) : null;
    if (doi === null) {
      withoutDoi += 1;
      return;
    }
    if (seen.has(doi)) return;
    seen.add(doi);
    records.push(referenceRecord(doi, retrievedAtEpochMs));
    edges.push({ kind: "reference", rank: index + 1 });
  });
  return { deposited: entries.length, withoutDoi, records, edges };
}
