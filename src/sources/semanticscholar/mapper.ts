/**
 * Semantic Scholar paper JSON → `SourceRecord`.
 *
 * **Scope.** `P2-T05` step 6. This is the function `semanticscholarSource.ts`
 * injects as {@link SemanticScholarSourceDeps.mapRecords}: one array of paper
 * objects in — a bulk or relevance page's `data`, or a `/paper/batch` answer —
 * that array's records out, synchronously, `null` entries skipped. The
 * call-site shape is {@link SemanticScholarRecordMapper}, the same split
 * `P1-T09` / `P1-T10` made for PubMed and `P2-T03`, `P2-T04`, `P2-T06` kept.
 *
 * ## Where every field comes from
 *
 * `docs/02` §10.2's **Semantic Scholar** column is the field-by-field source
 * table and is followed literally; `docs/07` §5.1 owns the *target* types and
 * wins where the two disagree. Four places they do, each recorded here:
 *
 * - **`externalIds.PubMedCentral` arrives bare** — `"10949956"`, no `PMC`
 *   prefix (§6.7's own sample; §10.2's cell says "add `PMC`"). It goes through
 *   `normalizePmcid`, whose contract is exactly that normalisation, so
 *   `ids.pmcid` is `PMC10949956` and keys the same cache entry as PubMed's and
 *   Europe PMC's spelling of the same id (`docs/02` §11.3).
 * - **`tldr.text`** (§10.2's `tldr` row, "S2 only") has **no slot in `docs/07`
 *   §5.1's `CanonicalWork`** — the only `tldr` §5.1 knows is `PaperSummary`'s
 *   derived one, which is Phase 3's and is explicitly "not stored model
 *   output". So the one-sentence TL;DR is used where `docs/02` §6.7 says it
 *   earns its place — "as a fallback when an abstract is missing" — and is
 *   otherwise not carried; {@link readTldr} exposes it for a caller that wants
 *   it. Reported with the card.
 * - **`openAccessPdf.disclaimer`** (§10.2's `openAccess.rightsNotice` row; §6.10
 *   says to preserve it in Zotero's `rights`) has **no slot in §5.1's
 *   `OpenAccessInfo`** (`isOpenAccess`, `status`, `pdfUrl`, `landingPageUrl`,
 *   `license`). It is not mapped; reported with the card.
 * - **Author names are abbreviated** (`"C. Theodoris"`, §6.7). `authors[].name`
 *   is split on its last space — the last token is the family name — and the
 *   merge's `authors` precedence (`src/model/merge.ts`, `docs/02` §10.4) puts
 *   this source last, so a fuller name from any other source wins.
 *
 * The rest is direct: `title`; `abstract`; `externalIds.DOI` / `.PubMed` /
 * `.ArXiv` through the `src/model/ids.ts` normalizers; `corpusId` →
 * `ids.s2CorpusId`; `journal.name` ‖ `venue` → `containerTitle`;
 * `journal.volume` / `journal.pages`; `publicationVenue.issn` → `issn`;
 * `publicationDate` ‖ `year` → `publishedDate` at day or year precision;
 * `citationCount`, `referenceCount`, `influentialCitationCount`;
 * `fieldsOfStudy` and `s2FieldsOfStudy[].category` → `subjects` under one
 * scheme, every term once; `isOpenAccess` and `openAccessPdf.{url,status,license}`
 * → `openAccess`; `url`; `publicationTypes` → `type` by §10.2's rules
 * (`preprint` when `venue` is a preprint server, `conference-paper` for
 * `Conference`, `book-chapter` for `BookSection`, `review` for `Review`,
 * `journal-article` for `JournalArticle` or when a venue with an ISSN exists,
 * `other` otherwise).
 *
 * **Identity.** `nativeId` is `paperId`, the S2 SHA (§6.3), and `id` is
 * `semanticscholar:<paperId>`. A paper object with no `paperId` is dropped with
 * a warning — §6.5 says `paperId` is always returned, so that is a malformed
 * entry, not a sparse one. A `null` entry is **skipped silently**: it is
 * §6.8's documented answer for an unknown id in a batch and the adapter
 * counts them.
 *
 * ## Absent vs. not understood — the same two-way split as the other mappers
 *
 * Absent → the field is absent and its name is in `missingFields`. Present but
 * not understood → absent, in `missingFields`, **and** a `warn` line through
 * the injected {@link Logger}. The domain of `missingFields` is
 * {@link SEMANTICSCHOLAR_MAPPABLE_FIELDS}.
 *
 * ## `raw`, and NFR-7
 *
 * Omitted by default. With {@link SemanticScholarMapperDeps.keepRaw} the record
 * keeps its own parsed paper object.
 *
 * ## Layering
 *
 * `sources/` may import `core/` and `model/` only (`docs/07` §2.3). Nothing
 * here names the `Zotero` global, reads a preference, touches a file or
 * issues a request.
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
  normalizeArxivId,
  normalizeDoi,
  normalizePmcid,
  normalizePmid,
  type ExternalIds,
  type S2CorpusId,
  type SourceId,
} from "../../model/ids";
import type { SourceRecord } from "../../model/sourceRecord";

// ---------------------------------------------------------------------------
// 1. Constants
// ---------------------------------------------------------------------------

/** `docs/07` §11.1 step 3: the `SourceId` *is* the adapter's identity. */
export const SEMANTICSCHOLAR_SOURCE_ID: SourceId = "semanticscholar";

/** `Subject.scheme` for `fieldsOfStudy` and `s2FieldsOfStudy[].category`. */
export const SEMANTICSCHOLAR_FIELD_OF_STUDY_SCHEME = "s2-field-of-study";

/**
 * The canonical fields `docs/02` §10.2's Semantic Scholar column says a paper
 * object can supply, in `docs/07` §5.1's spelling — the domain of
 * {@link SourceRecord.missingFields}.
 */
export const SEMANTICSCHOLAR_MAPPABLE_FIELDS: readonly string[] = [
  "title",
  "abstract",
  "authors",
  "type",
  "containerTitle",
  "volume",
  "pages",
  "issn",
  "publishedDate",
  "subjects",
  "citationCount",
  "referenceCount",
  "influentialCitationCount",
  "openAccess",
  "url",
  "ids.doi",
  "ids.pmid",
  "ids.pmcid",
  "ids.arxivId",
  "ids.s2CorpusId",
];

/**
 * `docs/02` §10.2's `type` rule: "S2 `venue` ∈ {bioRxiv, medRxiv, arXiv,
 * Research Square, SSRN}" → `preprint`. Compared case-insensitively, and
 * `arXiv.org` — the spelling the live API uses — is accepted beside the
 * document's `arXiv`.
 */
export const SEMANTICSCHOLAR_PREPRINT_VENUES: ReadonlySet<string> = new Set([
  "biorxiv",
  "medrxiv",
  "arxiv",
  "arxiv.org",
  "research square",
  "ssrn",
]);

/**
 * `docs/02` §10.2's `type` mapping table, Semantic Scholar triggers, **in the
 * table's own rule order** — `Conference` before `BookSection` before the
 * `journalArticle` default — plus the `publicationTypes` members (§6.5's
 * list) that are unambiguously one of §5.1's remaining `WorkType`s. The order
 * is load-bearing because a paper lists several types (measured 2026-10-15:
 * `["JournalArticle", "Conference"]` on a CLEO paper, `["Review",
 * "JournalArticle"]` on SciPy 1.0), and §10.2 ranks the rules, not the list.
 * Anything else falls to the venue rule in {@link readType}.
 */
const TYPE_RULES: readonly (readonly [string, WorkType])[] = [
  ["Conference", "conference-paper"],
  ["BookSection", "book-chapter"],
  ["JournalArticle", "journal-article"],
  ["Dataset", "dataset"],
  ["Review", "review"],
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

/** A non-empty string, whitespace-collapsed and trimmed; `undefined` otherwise. */
function str(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.replace(/\s+/gu, " ").trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** A finite non-negative integer; `undefined` otherwise. */
function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

// ---------------------------------------------------------------------------
// 3. Field readers
// ---------------------------------------------------------------------------

/** `YYYY-MM-DD`, the shape `publicationDate` takes (§6.7). */
const FULL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;

/**
 * `publicationDate` ‖ `year` → `docs/07` §5.1's `PartialDate` (§10.2's
 * `dates.issued` cell). A full date gives day precision; a bare year gives
 * year precision; §6.5 warns `publicationDate` "may be `null` even when the
 * filter matched", which is the `year` fallback's whole reason.
 *
 * @param publicationDate - `paper.publicationDate`
 * @param year - `paper.year`
 * @returns the date, or `undefined` when neither is usable
 */
export function readPublishedDate(
  publicationDate: unknown,
  year: unknown,
): PartialDate | undefined {
  const text = str(publicationDate);
  if (text !== undefined) {
    const match = FULL_DATE.exec(text);
    if (match !== null) {
      const y = Number(match[1]);
      const m = Number(match[2]);
      const d = Number(match[3]);
      if (y > 0 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
        return { year: y, month: m, day: d, iso: text };
      }
    }
  }
  const y = count(year);
  if (y !== undefined && y > 0) return { year: y, iso: String(y) };
  return undefined;
}

/**
 * `authors[].name` split on its last space: the last token is the family
 * name, the rest the given name(s) (§10.2's "split from `authors[].name`").
 * §6.7 warns the given part is usually an initial.
 *
 * @param name - one `authors[].name`
 * @returns the two halves
 */
export function splitAuthorName(name: string): {
  readonly family: string;
  readonly given: string | undefined;
} {
  const tokens = name.split(" ");
  const family = tokens[tokens.length - 1] ?? name;
  const given = tokens.slice(0, -1).join(" ");
  return { family, given: given === "" ? undefined : given };
}

/** One `authors[]` entry; `null` when it has no usable `name`. */
function mapAuthor(entry: unknown, sequence: number): Author | null {
  const name = str(asRecord(entry)?.name);
  if (name === undefined) return null;
  const { family, given } = splitAuthorName(name);
  return { family, ...(given !== undefined && { given }), sequence };
}

/**
 * `fieldsOfStudy` (strings) and `s2FieldsOfStudy[].category` → `subjects`,
 * one scheme, every term once, in first-seen order.
 */
export function readSubjects(paper: Json): readonly Subject[] {
  const seen = new Set<string>();
  const out: Subject[] = [];
  const add = (term: string | undefined): void => {
    if (term === undefined || seen.has(term.toLowerCase())) return;
    seen.add(term.toLowerCase());
    out.push({ term, scheme: SEMANTICSCHOLAR_FIELD_OF_STUDY_SCHEME });
  };
  for (const value of asArray(paper.fieldsOfStudy)) add(str(value));
  for (const value of asArray(paper.s2FieldsOfStudy)) {
    add(str(asRecord(value)?.category));
  }
  return out;
}

/**
 * `isOpenAccess` and `openAccessPdf.{url,status,license}` → `OpenAccessInfo`
 * (§10.2's three `openAccess.*` rows). `disclaimer` has no §5.1 slot and is
 * not carried (file header). Absent when the paper says nothing about either.
 */
export function readOpenAccess(paper: Json): OpenAccessInfo | undefined {
  const flag = paper.isOpenAccess;
  const pdf = asRecord(paper.openAccessPdf);
  const pdfUrl = str(pdf?.url);
  const status = str(pdf?.status);
  const license = str(pdf?.license);
  if (typeof flag !== "boolean" && pdfUrl === undefined) return undefined;
  return {
    isOpenAccess: typeof flag === "boolean" ? flag : pdfUrl !== undefined,
    ...(status !== undefined && { status: status.toLowerCase() }),
    ...(pdfUrl !== undefined && { pdfUrl }),
    ...(license !== undefined && { license }),
  };
}

/** `tldr.text`, when present (§6.7). Exposed for callers; see the header. */
export function readTldr(paper: unknown): string | undefined {
  return str(asRecord(asRecord(paper)?.tldr)?.text);
}

/**
 * `externalIds` → `ExternalIds` through the `src/model/ids.ts` normalizers.
 * `PubMedCentral` arrives **bare** and `normalizePmcid` adds the prefix.
 * `corpusId` (or `externalIds.CorpusId`) is the S2 corpus id. `url` is set as
 * the fallback identifier only when no stable one exists (§5.1's comment).
 */
export function readExternalIds(paper: Json): ExternalIds {
  const external = asRecord(paper.externalIds) ?? {};
  const doi = normalizeDoi(str(external.DOI));
  const pmid = normalizePmid(str(external.PubMed));
  const pmcid = normalizePmcid(str(external.PubMedCentral));
  const arxivId = normalizeArxivId(str(external.ArXiv));
  const corpus = count(paper.corpusId) ?? count(external.CorpusId);
  const s2CorpusId =
    corpus === undefined ? undefined : (String(corpus) as S2CorpusId);
  const url = str(paper.url);
  const stable =
    doi !== null ||
    pmid !== null ||
    pmcid !== null ||
    arxivId !== null ||
    s2CorpusId !== undefined;
  return {
    ...(doi !== null && { doi }),
    ...(pmid !== null && { pmid }),
    ...(pmcid !== null && { pmcid }),
    ...(arxivId !== null && { arxivId }),
    ...(s2CorpusId !== undefined && { s2CorpusId }),
    ...(!stable && url !== undefined && { url }),
  };
}

/**
 * `docs/02` §10.2's `type` rules for this column, in order: a preprint venue
 * wins; then the first of `TYPE_RULES` (in the rules' order, not the list's)
 * that `publicationTypes` names; then
 * `journal-article` when a venue with an ISSN (or any journal name) exists;
 * else `other`. The second value says whether the type was classified rather
 * than defaulted, for `missingFields`.
 */
export function readType(
  paper: Json,
  venue: string | undefined,
  hasJournal: boolean,
  arxivOnly = false,
): { readonly type: WorkType; readonly classified: boolean } {
  if (
    venue !== undefined &&
    SEMANTICSCHOLAR_PREPRINT_VENUES.has(venue.toLowerCase())
  ) {
    return { type: "preprint", classified: true };
  }
  const listed = new Set(
    asArray(paper.publicationTypes)
      .map((value) => str(value))
      .filter((value): value is string => value !== undefined),
  );
  for (const [name, mapped] of TYPE_RULES) {
    if (listed.has(name)) return { type: mapped, classified: true };
  }
  if (hasJournal) return { type: "journal-article", classified: true };
  // Beyond §10.2's cell, measured 2026-10-15 on `record-preprint`: a fresh
  // arXiv e-print arrives with `venue: ""`, `publicationTypes: null`, no
  // journal and `externalIds` holding only `ArXiv` (and `CorpusId`), so the
  // venue rule above cannot fire. A record whose only stable identifier is an
  // arXiv id and that names no venue is a preprint by the same reasoning the
  // arXiv column applies to every one of its records.
  if (arxivOnly) return { type: "preprint", classified: true };
  return { type: "other", classified: false };
}

// ---------------------------------------------------------------------------
// 4. One paper
// ---------------------------------------------------------------------------

/** What {@link createSemanticScholarRecordMapper} needs from the composition root. */
export interface SemanticScholarMapperDeps {
  /** `src/core/clock.ts`. Supplies `SourceRecord.retrievedAtEpochMs`. */
  readonly clock: Clock;
  /**
   * `docs/07` §5.1 / §8.5's `logRequestBodies`, resolved by the composition
   * root. `true` keeps each record's own parsed paper object; `false` — the
   * default, and what NFR-7 requires — keeps nothing.
   */
  readonly keepRaw?: boolean;
  /** Diagnostics. Never given an abstract or a whole paper. */
  readonly logger?: Logger;
}

/**
 * The mapper as `semanticscholarSource.ts` consumes it: one array of paper
 * objects in (a page's `data`, or a batch answer with its `null`s), that
 * array's records out, in order, `null`s and malformed entries skipped.
 */
export type SemanticScholarRecordMapper = (
  papers: readonly unknown[],
) => readonly SourceRecord[];

/**
 * Map one paper object.
 *
 * @param entry - one element of a page's `data` or a batch answer
 * @param retrievedAtEpochMs - the mapper clock's `now()`
 * @param keepRaw - whether to carry the parsed object as `raw`
 * @param warn - the mapper's warning channel
 * @returns the record, or `null` for a `null` entry or one with no `paperId`
 */
export function mapPaper(
  entry: unknown,
  retrievedAtEpochMs: number,
  keepRaw: boolean,
  warn: (msg: string, ctx: Record<string, unknown>) => void,
): SourceRecord | null {
  if (entry === null) return null;
  const paper = asRecord(entry);
  const paperId = str(paper?.paperId);
  if (paper === undefined || paperId === undefined) {
    warn("semanticscholar mapper: entry has no paperId, dropped", {
      field: "nativeId",
      path: "data[].paperId",
    });
    return null;
  }

  // --- title, abstract (tldr as the fallback the document names) ----------
  const title = str(paper.title) ?? "";
  const abstract = str(paper.abstract) ?? readTldr(paper);

  // --- authors ------------------------------------------------------------
  const authors: Author[] = [];
  let dropped = 0;
  for (const author of asArray(paper.authors)) {
    const mapped = mapAuthor(author, authors.length);
    if (mapped === null) dropped += 1;
    else authors.push(mapped);
  }
  if (dropped > 0) {
    warn("semanticscholar mapper: authors dropped for having no name", {
      field: "authors",
      path: "authors",
      dropped,
    });
  }

  // --- venue --------------------------------------------------------------
  const journal = asRecord(paper.journal);
  const journalName = str(journal?.name);
  const venue = str(paper.venue);
  const containerTitle = journalName ?? venue;
  const volume = str(journal?.volume);
  const pages = str(journal?.pages);
  const publicationVenue = asRecord(paper.publicationVenue);
  const issn = asArray(publicationVenue?.issn)
    .map((v) => str(v))
    .filter(
      (v, i, all): v is string => v !== undefined && all.indexOf(v) === i,
    );
  const singleIssn = str(publicationVenue?.issn);
  if (issn.length === 0 && singleIssn !== undefined) issn.push(singleIssn);

  // --- identifiers and type -----------------------------------------------
  const ids = readExternalIds(paper);
  const arxivOnly =
    ids.arxivId !== undefined &&
    ids.doi === undefined &&
    ids.pmid === undefined &&
    ids.pmcid === undefined &&
    venue === undefined;
  const { type, classified } = readType(
    paper,
    venue,
    journalName !== undefined || issn.length > 0,
    arxivOnly,
  );

  // --- the rest -----------------------------------------------------------
  const publishedDate = readPublishedDate(paper.publicationDate, paper.year);
  if (publishedDate === undefined && str(paper.publicationDate) !== undefined) {
    warn("semanticscholar mapper: publicationDate not understood", {
      field: "publishedDate",
      path: "publicationDate",
    });
  }
  const subjects = readSubjects(paper);
  const citationCount = count(paper.citationCount);
  const referenceCount = count(paper.referenceCount);
  const influentialCitationCount = count(paper.influentialCitationCount);
  const openAccess = readOpenAccess(paper);
  const url = str(paper.url);

  const work: SourceRecord["work"] = {
    ids,
    type,
    title,
    ...(abstract !== undefined && { abstract }),
    authors,
    ...(containerTitle !== undefined && { containerTitle }),
    ...(volume !== undefined && { volume }),
    ...(pages !== undefined && { pages }),
    ...(issn.length > 0 && { issn }),
    ...(publishedDate !== undefined && { publishedDate }),
    ...(subjects.length > 0 && { subjects }),
    ...(citationCount !== undefined && { citationCount }),
    ...(referenceCount !== undefined && { referenceCount }),
    ...(influentialCitationCount !== undefined && { influentialCitationCount }),
    ...(openAccess !== undefined && { openAccess }),
    ...(url !== undefined && { url }),
  };

  return {
    id: `${SEMANTICSCHOLAR_SOURCE_ID}:${paperId}`,
    sourceId: SEMANTICSCHOLAR_SOURCE_ID,
    nativeId: paperId,
    work,
    retrievedAtEpochMs,
    ...(keepRaw && { raw: paper }),
    missingFields: collectMissingFields(work, classified),
  };
}

/**
 * Every {@link SEMANTICSCHOLAR_MAPPABLE_FIELDS} member the paper did not
 * supply. `type` counts as supplied when it was classified, not when it fell
 * back to `"other"`.
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
  if (work.volume !== undefined) present.add("volume");
  if (work.pages !== undefined) present.add("pages");
  if (work.issn !== undefined) present.add("issn");
  if (work.publishedDate !== undefined) present.add("publishedDate");
  if (work.subjects !== undefined) present.add("subjects");
  if (work.citationCount !== undefined) present.add("citationCount");
  if (work.referenceCount !== undefined) present.add("referenceCount");
  if (work.influentialCitationCount !== undefined) {
    present.add("influentialCitationCount");
  }
  if (work.openAccess !== undefined) present.add("openAccess");
  if (work.url !== undefined) present.add("url");
  if (work.ids.doi !== undefined) present.add("ids.doi");
  if (work.ids.pmid !== undefined) present.add("ids.pmid");
  if (work.ids.pmcid !== undefined) present.add("ids.pmcid");
  if (work.ids.arxivId !== undefined) present.add("ids.arxivId");
  if (work.ids.s2CorpusId !== undefined) present.add("ids.s2CorpusId");
  return SEMANTICSCHOLAR_MAPPABLE_FIELDS.filter((f) => !present.has(f));
}

// ---------------------------------------------------------------------------
// 5. The mapper
// ---------------------------------------------------------------------------

/**
 * Build the mapper.
 *
 * @param deps - the clock, and optionally `keepRaw` and a logger
 * @returns a {@link SemanticScholarRecordMapper}
 */
export function createSemanticScholarRecordMapper(
  deps: SemanticScholarMapperDeps,
): SemanticScholarRecordMapper {
  const keepRaw = deps.keepRaw ?? false;
  const warn = (msg: string, ctx: Record<string, unknown>): void => {
    deps.logger?.warn(msg, { sourceId: SEMANTICSCHOLAR_SOURCE_ID, ...ctx });
  };
  return (papers) => {
    const now = deps.clock.now();
    const out: SourceRecord[] = [];
    for (const entry of papers) {
      const record = mapPaper(entry, now, keepRaw, warn);
      if (record !== null) out.push(record);
    }
    return out;
  };
}
