/**
 * Europe PMC `resultType=core` JSON → `SourceRecord`.
 *
 * **Scope.** `P2-T03` step 5. This is the function `europepmcSource.ts` injects
 * as {@link EuropePmcSourceDeps.mapRecords}: one page's `resultList.result`
 * array in, that page's records out, synchronously. The call-site shape is
 * {@link EuropePmcRecordMapper}, fixed by `europepmcSource.ts` and not invented
 * here — the same split `P1-T09` / `P1-T10` made for PubMed.
 *
 * ## Where every field comes from
 *
 * `docs/02` §10.2's **Europe PMC (`core`)** column is the field-by-field source
 * table and is followed literally; `docs/07` §5.1 owns the *target* types and
 * wins where the two disagree (§10.1's reconciliation note). The divergences
 * that bite, as for PubMed (`src/sources/pubmed/mapper.ts`): §10.2's
 * `venue.*` / `dates.issued` / `meshTerms` are §5.1's `containerTitle` /
 * `publishedDate` / `subjects`. Three more are Europe PMC's own:
 *
 * - **`ids.epmc` — `{ id, source }` — has no `ExternalIds` member** in §5.1.
 *   It is the record's *native* identity, so it goes where §5.1 puts native
 *   identity: `SourceRecord.nativeId` is `"MED/37258680"` / `"PPR/PPR657399"`,
 *   the `{source}/{id}` path every per-record endpoint in §4.2 takes, and
 *   `SourceRecord.id` is `"europepmc:MED/37258680"`. Reported with the card.
 * - **`pubTypeList` → `subjects`** in §10.2, but §5.1's `subjects` is the
 *   `Subject[]` MeSH fills (`scheme: "mesh"`), and `P1-T10` kept publication
 *   types out of it for PubMed. The same here: `pubTypeList` is read for
 *   `type` only. `meshHeadingList` → `subjects`; Europe PMC sends no MeSH `UI`,
 *   so `Subject.id` is absent.
 * - **`venue.repository` → `bookOrReportDetails.publisher`** (the preprint
 *   server name, "bioRxiv"). §5.1 has no `repository`; `docs/07` §6.2 maps a
 *   preprint's `containerTitle` to Zotero's `repository`, so the publisher goes
 *   into `containerTitle` (and `publisher`) for a `preprint`.
 *
 * **The published version of a preprint** is not in §10.2's table but is in
 * the recorded corpus (2026-10-14): a `PPR` record carries
 * `commentCorrectionList.commentCorrection[]` with `type: "Preprint of"`,
 * `source: "MED"` and the published PMID in `id`. That is exactly §5.1's
 * `relatedVersionIds` ("Set when this preprint has a published version"), so
 * it is mapped to `{ pmid }`. The reverse link (`type: "Preprint in"` on a
 * `MED` record, pointing at a `PPR` id) has no `ExternalIds` member and is
 * not mapped; reported.
 *
 * ## Inline markup — measured, and in two spellings
 *
 * `docs/02` §4.4's measurement: 33 of 93 abstracts carried inline HTML
 * (`<i>…</i>`). The recorded corpus adds: `<sup>` and `<h4>` section headings
 * in abstracts, **raw** `<b>` tags in a title
 * (`post<b>-</b>translational`) **and** entity-escaped tags in another
 * (`&lt;i&gt;Zingiber cassumunar&lt;/i&gt;`). So {@link flattenMarkup} decodes
 * entities *first* and strips tags *second*, which handles both spellings;
 * `<h4>Label</h4>` becomes a `"Label: "` paragraph prefix, which is `docs/07`
 * §5.1's `abstract` rule ("flattened with section labels preserved") and the
 * shape `P1-T10` gives PubMed's structured abstracts. There is no DOM here:
 * the sandbox's `DOMParser` is not needed for JSON and a regex over a known,
 * flat tag vocabulary is enough.
 *
 * ## Dates
 *
 * §10.2: `firstPublicationDate` ‖ `journalInfo.printPublicationDate`. Both
 * are `YYYY-MM-DD` in every recorded record; `pubYear` (a string) is the
 * year-only fallback. {@link readPartialDate} accepts `YYYY`, `YYYY-MM` and
 * `YYYY-MM-DD` and never invents precision.
 *
 * ## Absent vs. not understood — the same two-way split as PubMed's mapper
 *
 * Absent → the field is absent and its name is in `missingFields`. Present but
 * not understood → absent, in `missingFields`, **and** a `warn` line through
 * the injected {@link Logger}. The domain of `missingFields` is
 * {@link EUROPEPMC_MAPPABLE_FIELDS}; a field Europe PMC never supplies
 * (`referenceCount`, `influentialCitationCount`) is not a gap and is not
 * reported.
 *
 * ## `raw`, and NFR-7
 *
 * Omitted by default (NFR-7: raw payloads are not retained after
 * normalization). With {@link EuropePmcMapperDeps.keepRaw} the record keeps
 * its own parsed `result` object — one per record, because the page body is
 * already parsed and re-serializing it would be the waste NFR-7 forbids.
 *
 * ## Layering
 *
 * `sources/` may import `core/` and `model/` only (`docs/07` §2.3). Nothing
 * here names the `Zotero` global, reads a preference, touches a file or
 * imports `src/zotero/**`. Diagnostics go through {@link Logger}.
 */

import type { Clock } from "../../core/clock";
import type { Logger } from "../../core/logger";
import type {
  Author,
  OpenAccessInfo,
  PartialDate,
  Subject,
  WorkType,
} from "../../model/canonicalWork";
import {
  normalizeDoi,
  normalizePmcid,
  normalizePmid,
  type ExternalIds,
  type SourceId,
} from "../../model/ids";
import type { SourceRecord } from "../../model/sourceRecord";

// ---------------------------------------------------------------------------
// 1. Constants
// ---------------------------------------------------------------------------

/** `docs/07` §11.1 step 3: the `SourceId` *is* the adapter's identity. */
export const EUROPEPMC_SOURCE_ID: SourceId = "europepmc";

/** `docs/02` §4.2 / §4.5: the preprint corpus code. */
export const EUROPEPMC_PREPRINT_SOURCE = "PPR";

/**
 * The canonical fields `docs/02` §10.2's Europe PMC column says `core` can
 * supply, in `docs/07` §5.1's spelling — the domain of
 * {@link SourceRecord.missingFields}. `ids.pmid` **is** listed, unlike
 * PubMed's mapper: a `PPR` record legitimately has none, and that absence is
 * exactly what the preprint↔published resolution of `docs/02` §11.4 wants to
 * know.
 */
export const EUROPEPMC_MAPPABLE_FIELDS: readonly string[] = [
  "title",
  "abstract",
  "authors",
  "type",
  "containerTitle",
  "containerAbbreviation",
  "volume",
  "issue",
  "pages",
  "issn",
  "publishedDate",
  "language",
  "subjects",
  "keywords",
  "citationCount",
  "openAccess",
  "ids.doi",
  "ids.pmid",
  "ids.pmcid",
];

// ---------------------------------------------------------------------------
// 2. JSON walking helpers — no `any`, every read guarded
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;

/** `{...}` and not `null`, `[]` or a primitive. */
function asRecord(value: unknown): Json | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Json)
    : undefined;
}

function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

/** A non-empty string, whitespace-trimmed; `undefined` otherwise. */
function str(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** A finite number, or a digit string; `undefined` otherwise. */
function num(value: unknown): number | undefined {
  if (typeof value === "number")
    return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string" && /^\d+$/u.test(value)) return Number(value);
  return undefined;
}

/** `at(result, "journalInfo", "journal")` — an exact object path. */
function at(
  root: Json | undefined,
  ...names: readonly string[]
): Json | undefined {
  let cursor = root;
  for (const name of names) {
    cursor = asRecord(cursor?.[name]);
    if (cursor === undefined) return undefined;
  }
  return cursor;
}

// ---------------------------------------------------------------------------
// 3. Inline markup
// ---------------------------------------------------------------------------

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/**
 * Decode the HTML entities Europe PMC emits: the five XML ones, `&nbsp;`, and
 * numeric references in both bases. An unknown named entity is left as it is
 * rather than guessed.
 */
function decodeEntities(text: string): string {
  return text.replace(
    /&(#x[0-9a-fA-F]+|#\d+|[A-Za-z][A-Za-z0-9]*);/gu,
    (whole, body: string) => {
      if (body.startsWith("#x") || body.startsWith("#X")) {
        return safeCodePoint(Number.parseInt(body.slice(2), 16), whole);
      }
      if (body.startsWith("#")) {
        return safeCodePoint(Number.parseInt(body.slice(1), 10), whole);
      }
      return NAMED_ENTITIES[body] ?? whole;
    },
  );
}

function safeCodePoint(cp: number, fallback: string): string {
  return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff
    ? String.fromCodePoint(cp)
    : fallback;
}

/**
 * The whitespace layout introduces — tab, line feed, form feed, carriage
 * return, space — and only that. `\s` would also fold `&nbsp;` and the
 * Unicode spaces, which `P1-T10` found is invisible when it goes wrong.
 */
const PRINT_WHITESPACE = /[\t\n\f\r ]+/gu;

function squash(value: string): string {
  return value.replace(PRINT_WHITESPACE, " ").replace(/^ | $/gu, "");
}

/** `<h4>Label</h4>` — Europe PMC's structured-abstract section heading. */
const SECTION_HEADING = /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]\s*>/giu;

/** Any remaining tag, opening, closing or self-closing. */
const ANY_TAG = /<\/?[A-Za-z][^<>]*>/gu;

/**
 * Flatten Europe PMC inline markup to text.
 *
 * Entities are decoded **before** tags are stripped, because the corpus holds
 * tags in both spellings (`<b>` raw and `&lt;i&gt;` escaped); decoding first
 * turns the second into the first. A heading becomes a `"Label: "` prefix
 * starting a new paragraph (`\n\n`), the rest of the tags vanish, and the
 * whitespace inside each paragraph is squashed. Exported so the unit tests can
 * pin it on the recorded strings.
 *
 * @param text - a `title` or `abstractText` as Europe PMC sent it
 * @returns plain text; `""` for empty input
 */
export function flattenMarkup(text: string): string {
  const decoded = decodeEntities(text);
  const withLabels = decoded.replace(
    SECTION_HEADING,
    (_m, label: string) => `\n\n${squash(label.replace(ANY_TAG, ""))}: `,
  );
  const stripped = withLabels.replace(ANY_TAG, "");
  return stripped
    .split(/\n\s*\n/u)
    .map((paragraph) => squash(paragraph))
    .filter((paragraph) => paragraph.length > 0)
    .join("\n\n");
}

// ---------------------------------------------------------------------------
// 4. Dates
// ---------------------------------------------------------------------------

const ISO_PARTIAL = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/u;

/**
 * `YYYY`, `YYYY-MM` or `YYYY-MM-DD` → `docs/07` §5.1's `PartialDate`, at the
 * precision given and no finer. Anything else — including Europe PMC's
 * free-text `dateOfPublication` such as `"2023 Sept 28"` — is `undefined`,
 * so the caller can try the next candidate.
 */
export function readPartialDate(value: unknown): PartialDate | undefined {
  const text = str(value);
  if (text === undefined) return undefined;
  const match = ISO_PARTIAL.exec(text);
  if (match === null) return undefined;
  const year = Number(match[1]);
  const month = match[2] === undefined ? undefined : Number(match[2]);
  const day = match[3] === undefined ? undefined : Number(match[3]);
  if (year === 0) return undefined;
  if (month !== undefined && (month < 1 || month > 12)) return undefined;
  const dayOk = day !== undefined && day >= 1 && day <= 31;
  const iso =
    month === undefined
      ? (match[1] ?? "")
      : dayOk
        ? text
        : `${match[1] ?? ""}-${match[2] ?? ""}`;
  return {
    year,
    ...(month !== undefined && { month }),
    ...(month !== undefined && dayOk && { day }),
    iso,
  };
}

/**
 * `publishedDate`, in `docs/02` §10.2's order: `firstPublicationDate` ‖
 * `journalInfo.printPublicationDate`, then `pubYear` as a year-only fallback.
 * A candidate that is present but unreadable is logged and the next is tried.
 */
function readPublishedDate(
  result: Json,
  warn: (msg: string, ctx: Record<string, unknown>) => void,
): PartialDate | undefined {
  const candidates: readonly { path: string; value: unknown }[] = [
    { path: "firstPublicationDate", value: result.firstPublicationDate },
    {
      path: "journalInfo.printPublicationDate",
      value: at(result, "journalInfo")?.printPublicationDate,
    },
    { path: "pubYear", value: result.pubYear },
  ];
  for (const candidate of candidates) {
    if (str(candidate.value) === undefined) continue;
    const date = readPartialDate(candidate.value);
    if (date !== undefined) return date;
    warn("europepmc mapper: date not understood", {
      field: "publishedDate",
      path: candidate.path,
      value: String(candidate.value).slice(0, 40),
    });
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// 5. Authors
// ---------------------------------------------------------------------------

/**
 * `docs/07` §5.1: "Bare ORCID … (no URL prefix)". Europe PMC sends the bare
 * form under `authorId: { type: "ORCID", value }`; the URL prefix is stripped
 * anyway, and anything that is not 15 digits plus a digit-or-X check is not
 * an ORCID and is dropped rather than emitted wrong-shaped.
 */
function normalizeOrcid(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const digits = raw
    .trim()
    .replace(/^https?:\/\/(www\.)?orcid\.org\//iu, "")
    .replace(/[\s-]/gu, "");
  if (!/^\d{15}[\dX]$/iu.test(digits)) return undefined;
  return [
    digits.slice(0, 4),
    digits.slice(4, 8),
    digits.slice(8, 12),
    digits.slice(12, 16).toUpperCase(),
  ].join("-");
}

/**
 * One `authorList.author[]` entry. `docs/07` §5.1: an author with no name is
 * dropped (the caller warns). `collectiveName` — the consortium form — fills
 * `family` *and* `literal`, as PubMed's mapper does, so the author survives.
 */
function mapAuthor(entry: unknown, sequence: number): Author | null {
  const author = asRecord(entry);
  if (author === undefined) return null;
  const family = str(author.lastName);
  const given = str(author.firstName);
  const collective = str(author.collectiveName);
  const name = family ?? collective;
  if (name === undefined) return null;

  const authorId = asRecord(author.authorId);
  const orcid =
    authorId !== undefined && str(authorId.type)?.toUpperCase() === "ORCID"
      ? normalizeOrcid(str(authorId.value))
      : undefined;

  const affiliations = asArray(
    at(author, "authorAffiliationDetailsList")?.authorAffiliation,
  )
    .map((a) => str(asRecord(a)?.affiliation))
    .filter((a): a is string => a !== undefined)
    .map((a) => squash(a));

  return {
    family: name,
    ...(family !== undefined && given !== undefined && { given }),
    ...(family === undefined &&
      collective !== undefined && { literal: collective }),
    ...(orcid !== undefined && { orcid }),
    ...(affiliations.length > 0 && { affiliations }),
    sequence,
  };
}

// ---------------------------------------------------------------------------
// 6. Subjects, open access, related versions
// ---------------------------------------------------------------------------

/** One `Subject` per `meshHeadingList.meshHeading[].descriptorName`. */
function readSubjects(result: Json): Subject[] {
  const out: Subject[] = [];
  for (const entry of asArray(at(result, "meshHeadingList")?.meshHeading)) {
    const heading = asRecord(entry);
    const term = str(heading?.descriptorName);
    if (heading === undefined || term === undefined) continue;
    out.push({
      term,
      scheme: "mesh",
      isMajor: heading.majorTopic_YN === "Y",
    });
  }
  return out;
}

/** `availabilityCode` values that mean the URL is readable without a subscription. */
const FREE_CODES: ReadonlySet<string> = new Set(["F", "OA"]);

/**
 * `docs/02` §10.2: `openAccess.pdfUrl` from `fullTextUrlList`
 * (availabilityCode `F`), `openAccess.license` from `license`;
 * `isOpenAccess` from the record's own `isOpenAccess` flag. Emitted only
 * when the record says anything about access at all.
 */
function readOpenAccess(result: Json): OpenAccessInfo | undefined {
  const flag = str(result.isOpenAccess);
  const license = str(result.license);
  let pdfUrl: string | undefined;
  let landingPageUrl: string | undefined;
  for (const entry of asArray(at(result, "fullTextUrlList")?.fullTextUrl)) {
    const link = asRecord(entry);
    if (link === undefined) continue;
    const code = str(link.availabilityCode);
    const url = str(link.url);
    if (code === undefined || !FREE_CODES.has(code) || url === undefined) {
      continue;
    }
    const style = str(link.documentStyle);
    if (style === "pdf") pdfUrl ??= url;
    else if (style === "html") landingPageUrl ??= url;
  }
  if (
    flag === undefined &&
    license === undefined &&
    pdfUrl === undefined &&
    landingPageUrl === undefined
  ) {
    return undefined;
  }
  return {
    isOpenAccess: flag === "Y",
    ...(pdfUrl !== undefined && { pdfUrl }),
    ...(landingPageUrl !== undefined && { landingPageUrl }),
    ...(license !== undefined && { license }),
  };
}

/**
 * The published version a preprint points at: `commentCorrectionList`
 * entries of `type: "Preprint of"` whose `source` is `MED` carry the PMID in
 * `id` (measured 2026-10-14 on three `PPR` records). Returns `undefined` when
 * there is none, so `relatedVersionIds` stays absent.
 */
function readRelatedVersionIds(result: Json): ExternalIds | undefined {
  for (const entry of asArray(
    at(result, "commentCorrectionList")?.commentCorrection,
  )) {
    const link = asRecord(entry);
    if (link === undefined) continue;
    if (str(link.type) !== "Preprint of") continue;
    if (str(link.source) !== "MED") continue;
    const pmid = normalizePmid(str(link.id));
    if (pmid !== null) return { pmid };
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// 7. One result
// ---------------------------------------------------------------------------

/** What {@link createEuropePmcRecordMapper} needs from the composition root. */
export interface EuropePmcMapperDeps {
  /** `src/core/clock.ts`. Supplies `SourceRecord.retrievedAtEpochMs`. */
  readonly clock: Clock;
  /**
   * `docs/07` §5.1 / §8.5's `logRequestBodies`, resolved by the composition
   * root. `true` keeps each record's own parsed `result` object; `false` —
   * the default, and what NFR-7 requires — keeps nothing.
   */
  readonly keepRaw?: boolean;
  /** Diagnostics. Never given an abstract or a whole record. */
  readonly logger?: Logger;
}

/**
 * The mapper as `europepmcSource.ts` consumes it: one page's
 * `resultList.result` array in, that page's records out, in order.
 */
export type EuropePmcRecordMapper = (
  results: readonly unknown[],
) => readonly SourceRecord[];

function mapResult(
  entry: unknown,
  retrievedAtEpochMs: number,
  keepRaw: boolean,
  warn: (msg: string, ctx: Record<string, unknown>) => void,
): SourceRecord | null {
  const result = asRecord(entry);
  const id = str(result?.id);
  const source = str(result?.source);
  if (result === undefined || id === undefined || source === undefined) {
    warn("europepmc mapper: result has no id/source, dropped", {
      field: "nativeId",
      path: "resultList.result[].id|source",
    });
    return null;
  }

  // --- identity -----------------------------------------------------------
  const rawDoi = str(result.doi);
  const doi = normalizeDoi(rawDoi);
  if (rawDoi !== undefined && doi === null) {
    warn("europepmc mapper: DOI not understood", {
      field: "ids.doi",
      path: "doi",
      value: rawDoi.slice(0, 64),
    });
  }
  const rawPmid = str(result.pmid);
  const pmid = normalizePmid(rawPmid);
  if (rawPmid !== undefined && pmid === null) {
    warn("europepmc mapper: PMID not understood", {
      field: "ids.pmid",
      path: "pmid",
      value: rawPmid.slice(0, 32),
    });
  }
  const rawPmcid = str(result.pmcid);
  const pmcid = normalizePmcid(rawPmcid);
  if (rawPmcid !== undefined && pmcid === null) {
    warn("europepmc mapper: PMCID not understood", {
      field: "ids.pmcid",
      path: "pmcid",
      value: rawPmcid.slice(0, 32),
    });
  }
  const ids: ExternalIds = {
    ...(doi !== null && { doi }),
    ...(pmid !== null && { pmid }),
    ...(pmcid !== null && { pmcid }),
  };

  // --- title and abstract --------------------------------------------------
  // `docs/02` §10.4: PubMed appends a trailing `.` to titles, and Europe PMC's
  // MED records are MEDLINE records, so the same period is stripped here —
  // that is what lets the two sources' titles compare equal in dedup.
  const rawTitle = str(result.title);
  const title =
    rawTitle === undefined ? "" : flattenMarkup(rawTitle).replace(/\.$/u, "");
  if (rawTitle !== undefined && title.length === 0) {
    warn("europepmc mapper: title present but empty after flattening", {
      field: "title",
      path: "title",
    });
  }
  const rawAbstract = str(result.abstractText);
  const abstract = rawAbstract === undefined ? "" : flattenMarkup(rawAbstract);
  if (rawAbstract !== undefined && abstract.length === 0) {
    warn("europepmc mapper: abstractText present but empty after flattening", {
      field: "abstract",
      path: "abstractText",
    });
  }

  // --- authors ------------------------------------------------------------
  const authors: Author[] = [];
  let dropped = 0;
  for (const author of asArray(at(result, "authorList")?.author)) {
    const mapped = mapAuthor(author, authors.length);
    if (mapped === null) dropped += 1;
    else authors.push(mapped);
  }
  if (dropped > 0) {
    warn("europepmc mapper: authors dropped for having no name", {
      field: "authors",
      path: "authorList.author",
      dropped,
    });
  }

  // --- venue --------------------------------------------------------------
  const journalInfo = at(result, "journalInfo");
  const journal = at(journalInfo, "journal");
  const publisher = str(at(result, "bookOrReportDetails")?.publisher);
  const journalTitle = str(journal?.title);
  const containerAbbreviation =
    str(journal?.medlineAbbreviation) ?? str(journal?.isoabbreviation);
  const issn = [str(journal?.issn), str(journal?.essn)].filter(
    (v, i, all): v is string => v !== undefined && all.indexOf(v) === i,
  );
  const volume = str(journalInfo?.volume);
  const issue = str(journalInfo?.issue);
  const pages = str(result.pageInfo);

  // --- type: docs/02 §10.2's mapping table, Europe PMC triggers only --------
  const pubTypes = asArray(at(result, "pubTypeList")?.pubType)
    .map((t) => str(t)?.toLowerCase())
    .filter((t): t is string => t !== undefined);
  const isPreprint =
    source === EUROPEPMC_PREPRINT_SOURCE || pubTypes.includes("preprint");
  const hasVenueWithIssn = journalTitle !== undefined && issn.length > 0;
  const type: WorkType = isPreprint
    ? "preprint"
    : hasVenueWithIssn
      ? "journal-article"
      : "other";
  // A preprint's container is its server (`docs/07` §6.2 → Zotero `repository`).
  const containerTitle = isPreprint
    ? (publisher ?? journalTitle)
    : journalTitle;

  // --- the rest -----------------------------------------------------------
  const publishedDate = readPublishedDate(result, warn);
  const language = str(result.language);
  const subjects = readSubjects(result);
  const keywords = asArray(at(result, "keywordList")?.keyword)
    .map((k) => str(k))
    .filter((k): k is string => k !== undefined);
  const citationCount = num(result.citedByCount);
  const openAccess = readOpenAccess(result);
  const relatedVersionIds = readRelatedVersionIds(result);

  const work: SourceRecord["work"] = {
    ids,
    type,
    title,
    ...(abstract.length > 0 && { abstract }),
    authors,
    ...(containerTitle !== undefined && { containerTitle }),
    ...(containerAbbreviation !== undefined && { containerAbbreviation }),
    ...(publisher !== undefined && { publisher }),
    ...(volume !== undefined && { volume }),
    ...(issue !== undefined && { issue }),
    ...(pages !== undefined && { pages }),
    ...(issn.length > 0 && { issn }),
    ...(publishedDate !== undefined && { publishedDate }),
    ...(language !== undefined && { language }),
    ...(subjects.length > 0 && { subjects }),
    ...(keywords.length > 0 && { keywords }),
    ...(citationCount !== undefined && { citationCount }),
    ...(openAccess !== undefined && { openAccess }),
    ...(relatedVersionIds !== undefined && { relatedVersionIds }),
  };

  const nativeId = `${source}/${id}`;
  return {
    id: `${EUROPEPMC_SOURCE_ID}:${nativeId}`,
    sourceId: EUROPEPMC_SOURCE_ID,
    nativeId,
    work,
    retrievedAtEpochMs,
    ...(keepRaw && { raw: result }),
    missingFields: collectMissingFields(work, isPreprint || hasVenueWithIssn),
  };
}

/**
 * Every {@link EUROPEPMC_MAPPABLE_FIELDS} member the record did not supply.
 * `type` counts as supplied when it was classified (`preprint` or
 * `journal-article`), not when it fell back to `"other"`.
 */
function collectMissingFields(
  work: SourceRecord["work"],
  typeClassified: boolean,
): readonly string[] {
  const present = new Set<string>();
  if (work.title.length > 0) present.add("title");
  if (work.abstract !== undefined) present.add("abstract");
  if (work.authors.length > 0) present.add("authors");
  if (typeClassified) present.add("type");
  if (work.containerTitle !== undefined) present.add("containerTitle");
  if (work.containerAbbreviation !== undefined) {
    present.add("containerAbbreviation");
  }
  if (work.volume !== undefined) present.add("volume");
  if (work.issue !== undefined) present.add("issue");
  if (work.pages !== undefined) present.add("pages");
  if (work.issn !== undefined) present.add("issn");
  if (work.publishedDate !== undefined) present.add("publishedDate");
  if (work.language !== undefined) present.add("language");
  if (work.subjects !== undefined) present.add("subjects");
  if (work.keywords !== undefined) present.add("keywords");
  if (work.citationCount !== undefined) present.add("citationCount");
  if (work.openAccess !== undefined) present.add("openAccess");
  if (work.ids.doi !== undefined) present.add("ids.doi");
  if (work.ids.pmid !== undefined) present.add("ids.pmid");
  if (work.ids.pmcid !== undefined) present.add("ids.pmcid");
  return EUROPEPMC_MAPPABLE_FIELDS.filter((f) => !present.has(f));
}

// ---------------------------------------------------------------------------
// 8. The mapper
// ---------------------------------------------------------------------------

/**
 * Build the `resultList.result[]` → `SourceRecord[]` mapper the adapter
 * injects. Synchronous; a result with no `id`/`source` is dropped with a
 * warning rather than emitted broken; nothing here throws for a malformed
 * entry, because the page-level shape is `europepmcSource.ts`'s to validate.
 *
 * @param deps - the clock, and optionally `keepRaw` and a logger
 * @returns the mapper
 */
export function createEuropePmcRecordMapper(
  deps: EuropePmcMapperDeps,
): EuropePmcRecordMapper {
  const keepRaw = deps.keepRaw ?? false;
  const { clock, logger } = deps;
  const warn = (msg: string, ctx: Record<string, unknown>): void => {
    logger?.warn(msg, { ...ctx, sourceId: EUROPEPMC_SOURCE_ID });
  };
  return (results) => {
    const retrievedAtEpochMs = clock.now();
    const out: SourceRecord[] = [];
    for (const entry of results) {
      const record = mapResult(entry, retrievedAtEpochMs, keepRaw, warn);
      if (record !== null) out.push(record);
    }
    return out;
  };
}
