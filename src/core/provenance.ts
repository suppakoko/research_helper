// src/core/provenance.ts — pure; imports only model/ (§2.3)

/**
 * `SearchProvenance` / `SourceProvenance` and FR-8's JSON export (`P1-T17`).
 *
 * ## The header comment above is `docs/07` §5.3's, transcribed
 *
 * §5.3 prints the file's first line as `// src/core/provenance.ts — pure;
 * imports only model/ (§2.3)`, and `docs/07` §2.2's tree repeats it ("pure,
 * imports only model/ — satisfies §2.3"). This file additionally imports
 * `./errors`, and that is not a violation of either statement:
 *
 * - §5.3's own `SourceProvenance.error` is typed `SerializedError`, which §5.2
 *   declares and §2.2's tree places in `src/core/errors.ts`. There is no way to
 *   transcribe §5.3's interface without naming a `core/` symbol, so "imports
 *   only `model/`" cannot be read as "imports nothing from `core/`" without
 *   making §5.3 self-contradictory.
 * - §2.3's rule, which is the one the ESLint config enforces, is `core/ →
 *   model/`: `core/` may not import `bootstrap/`, `sources/`, `llm/`, `tts/`,
 *   `pipeline/`, `zotero/`, `ui/`, `prefs/`, `prompts/`, `i18n/` or `utils/`.
 *   An intra-`core/` import is inside the layer, not across it —
 *   `src/core/logger.ts` already imports `./errors` for the same reason.
 *
 * So the phrase means "no layer above `model/`", i.e. **no Zotero global, no
 * platform API**, which this file honours: the one platform capability it needs
 * is writing a file, and §2.3 says `core/` takes that as a *port*
 * ({@link ProvenanceFileWriter}).
 *
 * ## What is authoritative, and what is a projection
 *
 * §5.3's "Where it lives" makes the SQLite `search_provenance` row (§8.3)
 * authoritative, and Phase 1 ships no plugin-owned SQLite
 * (`plan/02-phase-1-pubmed.md` §3). So in Phase 1
 * the run's in-memory {@link SearchProvenance} **is** the authority, and both
 * outputs are projections of it:
 *
 * | artefact | produced by | relationship to the record |
 * |---|---|---|
 * | the JSON export | {@link serializeProvenance} | `JSON.stringify` of the whole record — complete by construction |
 * | the standalone note | `src/zotero/notes.ts` | a hand-written HTML rendering of selected fields — **not** complete by construction |
 *
 * `P2-T17` adds the table and inherits this object unchanged.
 *
 * ## Redaction is a gate, not a convention
 *
 * NFR-16 names provenance records as one of the channels an API key must never
 * reach, and §5.3 says redaction "runs before either value is stored".
 * {@link redactSearchProvenance} is that gate. It is idempotent, so calling it
 * again at the export boundary costs nothing and removes the need to trust that
 * the caller called it.
 */

import { redact, redactUrl, type SerializedError } from "./errors";
import type { SourceId } from "../model/ids";

// ---------------------------------------------------------------------------
// 1. The record — `docs/07` §5.3, transcribed
//
// Every field name, field type and doc comment below is §5.3's. The only
// textual difference from §5.3's printed block is that Prettier wraps the
// `dateFilter` declaration across two lines at the 80-column limit
// `npm run lint:check` enforces; §5.3 prints it on one. `P1-T17`'s third
// criterion asks for the comparison "by diff, not by memory", and the diff
// that backs it normalises whitespace and finds no other difference across all
// 27 declarations (15 in `SearchProvenance`, counting the two nested object
// literals' members, and 12 in `SourceProvenance`).
// ---------------------------------------------------------------------------

/** One executed search run. Written once, when the run finishes or is cancelled. */
export interface SearchProvenance {
  /** Schema version of this record, independent of the plugin version. */
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly pluginVersion: string;
  readonly zoteroVersion: string;
  readonly startedAt: string; // ISO 8601
  readonly finishedAt: string; // ISO 8601
  /** The user's query, verbatim, before per-source translation (FR-4). */
  readonly userQuery: string;
  /**
   * The resolved recency window, or `"none"` when the user chose "All years"
   * (FR-3: "the provenance record states `dateFilter: none`").
   */
  readonly dateFilter:
    { readonly fromIso: string; readonly toIso: string } | "none";
  readonly targetLibraryId: number;
  readonly targetCollectionKey: string | undefined;
  readonly perSource: readonly SourceProvenance[];
  /** Run totals. `deduplicatedAway` is 0, not absent, when only one source ran. */
  readonly totals: {
    readonly retrieved: number;
    readonly deduplicatedAway: number;
    readonly imported: number;
  };
}

/** FR-8's per-source enumeration, one entry per source that was asked. */
export interface SourceProvenance {
  readonly sourceId: SourceId;
  /** Endpoint base URL, without query string. */
  readonly endpointBaseUrl: string;
  /**
   * The transmitted query string, and the exact transmitted URL, **with API keys
   * redacted** (FR-4, NFR-16). Redaction uses the `KEY_PATTERNS` rules in
   * `09-security-privacy-and-api-keys.md` §2.1 and runs before either value is stored.
   */
  readonly transmittedQuery: string;
  readonly transmittedUrl: string;
  /** `"server"` when the source filtered, `"client"` when we did (FR-3), `"none"`. */
  readonly dateFilterApplied: "server" | "client" | "none";
  readonly requestedLimit: number;
  /** Raw hit count the source reported, before any local filtering. */
  readonly rawHitCount: number | undefined;
  readonly recordsRetrieved: number;
  readonly recordsDeduplicatedAway: number;
  readonly recordsImported: number;
  /** Populated when the source failed or degraded; `undefined` on a clean run. */
  readonly error: SerializedError | undefined;
  /**
   * Source-specific extras worth keeping, keyed by the source's own field names —
   * e.g. PubMed's `count`, `querytranslation` and `translationset`
   * (`02-literature-database-apis.md` §12.4). Never a credential, never a raw body.
   */
  readonly sourceExtras: Readonly<Record<string, unknown>> | undefined;
}

/**
 * The `schemaVersion` literal `1`, as a value.
 *
 * §5.3 declares the *type* `1` and nothing in the corpus names a constant for
 * it, so this is not a transcribed declaration: it exists so that the record,
 * `schema/provenance.schema.json`'s `const`, and the test that compares the two
 * read one number instead of three.
 */
export const PROVENANCE_SCHEMA_VERSION = 1;

/**
 * The relative path of the shipped JSON Schema, from the repository root.
 *
 * Declared in `docs/07` §2.2's tree and `docs/13` §1.2's layout. Kept here so
 * the schema artefact and the interface it is generated from are named in one
 * place.
 */
export const PROVENANCE_SCHEMA_PATH = "schema/provenance.schema.json";

// ---------------------------------------------------------------------------
// 2. Redaction — the gate NFR-16 requires
// ---------------------------------------------------------------------------

/**
 * `redactUrl` for a **bare query string** — one with no scheme, host or `?`.
 *
 * ### Why this exists, measured 2026-10-07
 *
 * `SourceProvenance.transmittedQuery` is a query string, not a URL, and
 * `redactUrl` is a *no-op* on one. `new URL("db=pubmed&api_key=…",
 * "http://rh.invalid/")` parses the whole thing as a **path**, so
 * `searchParams` is empty and no named parameter is removed; what is left then
 * goes through `redact()`, and an NCBI key is 32 hexadecimal characters, below
 * `KEY_PATTERNS`' 40-character catch-all. Measured directly:
 *
 * ```
 * redactUrl("db=pubmed&term=crispr&api_key=0123456789abcdef0123456789abcdef")
 *   === "db=pubmed&term=crispr&api_key=0123456789abcdef0123456789abcdef"
 * ```
 *
 * `src/sources/pubmed/query.ts` never hits this, because it redacts the whole
 * URL once and slices the query string out of the *redacted* result. But the
 * field is `string` and this module is the gate, so the gate has to cover the
 * shape the field actually holds rather than the shape one caller happens to
 * send.
 *
 * The repair reuses the shipped rules rather than re-declaring
 * `SECRET_QUERY_PARAMS`: prefix a `?`, so `URL` parses the text as a query
 * string, then drop the prefix `redactUrl` leaves behind (`"/?"` when it
 * rebuilt the URL, `"?"` when it did not).
 *
 * @param queryString - a query string, with or without a leading `?`
 * @returns the query string with secret parameters removed and key-shaped runs
 *   redacted, never with a leading `?`
 */
export function redactQueryString(queryString: string): string {
  const withMark = queryString.startsWith("?")
    ? queryString
    : `?${queryString}`;
  const redacted = redactUrl(withMark);
  const start = redacted.indexOf("?");
  return start === -1 ? redacted : redacted.slice(start + 1);
}

/**
 * A URL **inside** free text, as `redact()` alone does not see it.
 *
 * Deliberately conservative: a URL ends at the first whitespace, quote or angle
 * bracket, which is every delimiter the strings this module redacts actually
 * use. A trailing `.` or `,` is left attached rather than trimmed, because
 * `redactUrl` tolerates it and trimming would guess at sentence punctuation.
 */
const URL_IN_TEXT = /https?:\/\/[^\s"'<>]+/g;

/**
 * Free text with every embedded URL put through `redactUrl`, then the whole
 * string through `redact`.
 *
 * ### Why `redact()` on its own is not enough, measured 2026-10-07
 *
 * `src/core/errors.ts` is explicit that "an NCBI key is shorter than
 * `redact()`'s 40-character catch-all", and `SerializedError.detail` is free
 * text that routinely quotes the failing request: `P1-T09`'s own `efetch`
 * failure message is built from a URL. So
 *
 * ```
 * redact("efetch failed for …/esearch.fcgi?api_key=0123456789abcdef0123456789abcdef")
 * ```
 *
 * returns the key verbatim — the first draft of this module did exactly that,
 * and the unit test below caught it. `src/core/logger.ts` solves the same
 * problem for a message that *is* a URL by testing it against `ABSOLUTE_URL`
 * first; a message that merely *contains* one needs the substring treatment.
 *
 * NFR-16 names notes and provenance records explicitly, so this runs over every
 * free-text field the record carries: `userQuery`, `SerializedError.detail` and
 * `.stack`, and every string inside `sourceExtras`.
 */
function redactText(text: string): string {
  return redact(text.replace(URL_IN_TEXT, (url) => redactUrl(url)));
}

/**
 * Every string anywhere inside a {@link SourceProvenance.sourceExtras} value,
 * put through {@link redactText}.
 *
 * §5.3 says `sourceExtras` is "Never a credential, never a raw body", and the
 * values are the *source's* own fields — PubMed's `querytranslation` echoes the
 * term the user typed, so a key pasted into the search box comes back in it.
 * Keys are structural; "never a raw body" is a caller rule this cannot check,
 * and inventing a size limit for it would be `plan/README.md` §5 rule 4.
 *
 * Arrays and nested objects are walked because `translationset` is an array of
 * objects. Non-string leaves are returned unchanged.
 */
function redactUnknown(value: unknown): unknown {
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map(redactUnknown);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      out[key] = redactUnknown(inner);
    }
    return out;
  }
  return value;
}

/**
 * One source's entry, with every credential-bearing field put through
 * `docs/09` §2.1's rules.
 *
 * Idempotent: `redactUrl` *removes* a named secret parameter rather than
 * blanking it, and `redact()`'s `[redacted:<n>]` marker matches none of
 * `KEY_PATTERNS`, so a second pass changes nothing.
 *
 * @param source - one source's draft entry
 * @returns the same entry with `endpointBaseUrl`, `transmittedQuery`,
 *   `transmittedUrl`, `error.detail`, `error.stack` and every string in
 *   `sourceExtras` redacted
 */
export function redactSourceProvenance(
  source: SourceProvenance,
): SourceProvenance {
  return {
    ...source,
    endpointBaseUrl: redactUrl(source.endpointBaseUrl),
    transmittedQuery: redactQueryString(source.transmittedQuery),
    transmittedUrl: redactUrl(source.transmittedUrl),
    error:
      source.error === undefined
        ? undefined
        : redactSerializedError(source.error),
    sourceExtras:
      source.sourceExtras === undefined
        ? undefined
        : (redactUnknown(source.sourceExtras) as Readonly<
            Record<string, unknown>
          >),
  };
}

/**
 * `SerializedError`'s two free-text members, redacted.
 *
 * §5.2's `detail` is documented "already redacted", and `src/core/errors.ts`'s
 * own header says the same — but this object is about to be written to a note
 * and to a file the user can share, and NFR-16 is absolute, so the gate does
 * not rely on an upstream promise. `code`, `messageKey`, `retryable` and
 * `httpStatus` are closed enumerations or numbers and cannot carry a key.
 *
 * The two optional members are spread conditionally because
 * `exactOptionalPropertyTypes` makes `{ httpStatus: undefined }` a type error
 * against `httpStatus?: number`.
 */
function redactSerializedError(error: SerializedError): SerializedError {
  return {
    code: error.code,
    messageKey: error.messageKey,
    detail: redactText(error.detail),
    retryable: error.retryable,
    ...(error.httpStatus !== undefined && { httpStatus: error.httpStatus }),
    ...(error.stack !== undefined && { stack: redactText(error.stack) }),
  };
}

/**
 * The whole record, redacted. **The only way a record should reach a note, a
 * file, or `P2-T17`'s table.**
 *
 * `userQuery` is redacted even though §5.3 calls it "the user's query,
 * verbatim". The two statements conflict and NFR-16 wins: it forbids a key in a
 * note or a provenance record without exception, and §5.3's own
 * `transmittedQuery` comment says redaction "runs before either value is
 * stored". A key-shaped run is never a legitimate search term, so the cost of
 * the stricter reading is zero and the cost of the looser one is a published
 * credential.
 *
 * Idempotent, like {@link redactSourceProvenance}.
 *
 * @param provenance - the run's draft record
 * @returns the record with every free-text field redacted
 */
export function redactSearchProvenance(
  provenance: SearchProvenance,
): SearchProvenance {
  return {
    ...provenance,
    userQuery: redactText(provenance.userQuery),
    perSource: provenance.perSource.map(redactSourceProvenance),
  };
}

// ---------------------------------------------------------------------------
// 3. The JSON export — FR-8's third clause
// ---------------------------------------------------------------------------

/** `JSON.stringify`'s indent, in spaces. FR-8's export is "pretty-printed". */
const EXPORT_INDENT = 2;

/**
 * The record as the bytes FR-8's export writes.
 *
 * A projection by `JSON.stringify` of the *whole* object rather than a
 * field-by-field rendering, which is what makes the export complete by
 * construction: a field added to §5.3 and to the interface above appears in the
 * export with no change here. `undefined`-valued members are omitted by
 * `JSON.stringify`, which is why `schema/provenance.schema.json` lists
 * `rawHitCount`, `error`, `sourceExtras` and `targetCollectionKey` in
 * `properties` but not in `required`.
 *
 * The trailing newline makes the file a well-formed POSIX text file; it is
 * outside the JSON value and no parser sees it.
 *
 * @param provenance - the run's record
 * @returns pretty-printed JSON, redacted, newline-terminated
 */
export function serializeProvenance(provenance: SearchProvenance): string {
  return `${JSON.stringify(
    redactSearchProvenance(provenance),
    undefined,
    EXPORT_INDENT,
  )}\n`;
}

/**
 * The slice of the platform the export needs, as a port (§2.3: "Where `core/`
 * needs a platform capability (prefs, files, HTTP, clock) it declares a *port*
 * interface and receives an implementation via the container").
 *
 * `src/zotero/notes.ts` satisfies it with one line over
 * `Zotero.File.putContentsAsync`, which `docs/01` §5.6's 2026-09-08
 * verification note calls "the simpler choice for text".
 */
export interface ProvenanceFileWriter {
  /** Write `text` to `path` as UTF-8, overwriting. */
  writeTextFile(path: string, text: string): Promise<unknown>;
}

/**
 * FR-8's "Export provenance as JSON": write the record to a user-chosen path.
 *
 * `P1-T17` step 4 names this `exportJson(path)`. `path` is the only argument
 * that comes from the user; the record and the writer are supplied by the
 * caller that already holds both, so they are parameters rather than module
 * state — a module-level record would make two concurrent runs share one.
 *
 * @param path - the user-chosen destination, absolute
 * @param provenance - the run's record; redacted again on the way out
 * @param files - the file-writing port
 */
export async function exportJson(
  path: string,
  provenance: SearchProvenance,
  files: ProvenanceFileWriter,
): Promise<void> {
  await files.writeTextFile(path, serializeProvenance(provenance));
}
