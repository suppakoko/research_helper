/**
 * bioRxiv / medRxiv JSON → `SourceRecord`.
 *
 * **Scope.** `P2-T07` steps 5 and 6. One mapper serves both servers and both
 * endpoints: `/details/`' `collection` (one entry per **version** of the
 * preprint) and `/pubs/`' `collection` (the cross-walk, `preprint_*` members).
 * The call-site shape is {@link BiorxivRecordMapper}; `biorxivSource.ts`
 * injects it, the split every other adapter makes.
 *
 * ## Where every field comes from
 *
 * `docs/02` §10.2's **bioRxiv `/details/`** column, followed literally, and
 * the card's step 5:
 *
 * - `title` ← `title` (`/pubs/`: `preprint_title`), verbatim.
 * - `abstract` ← `abstract` (`/pubs/`: `preprint_abstract`), through
 *   {@link cleanBiorxivAbstract} — `docs/02` §8.5 measured flattening tokens
 *   (`O_SCPCAP…C_SCPCAP`, `C_LIO_LI`) and section headings run into the prose
 *   ("BackgroundAs…"); the run-in headings were measured again on 2026-10-15
 *   in **both** endpoints' medRxiv abstracts ("BackgroundAddressing",
 *   "Design, Setting, and ParticipantsRetrospective"). A heading becomes a
 *   `"Heading: "` paragraph prefix, the convention `docs/07` §5.1's
 *   `abstract` merge row and the PubMed / Europe PMC mappers already use
 *   ("section labels preserved"); the tokens are removed.
 * - `authors` ← `authors`, split from the `"Last, F.; Last, F."` string
 *   ({@link splitBiorxivAuthors}); `author_corresponding` /
 *   `author_corresponding_institution` mark the corresponding author and
 *   supply §10.2's only affiliation ("corr. only").
 * - `containerTitle` ← the server's display name — §10.2's `venue.repository`
 *   row (`server`), §10.3's `repository` values `"bioRxiv"` / `"medRxiv"`.
 * - `publishedDate` ← `date` → `PartialDate`. `/details/` returns **every
 *   version** of a DOI (measured: two for `10.1101/2020.04.14.20062463`,
 *   2020-04-17 and 2020-04-30), so the date is the **earliest** version's —
 *   the day the preprint was first posted — while every other field is the
 *   **latest** version's. A revision is not a new publication.
 * - `subjects` ← `category`, one term, scheme `biorxiv-category` /
 *   `medrxiv-category` (the two servers' category lists differ).
 * - `openAccess.license` ← `license`, **verbatim per record** (`docs/09` §5.6:
 *   licensing is author-selected, from CC BY to "no reuse"; measured values
 *   include `cc_by`, `cc_by_nc`, `cc_by_nc_nd` and `cc_no`, the last not in
 *   `docs/02` §8.5's list). Never assumed: a record with no `license` gets no
 *   `openAccess` at all (`/pubs/` carries none).
 * - `ids.doi` ← `doi` (`/pubs/`: `preprint_doi`), through `normalizeDoi`.
 * - `relatedVersionIds` ← `published` when it is not `"NA"` (`docs/02` §11.4's
 *   first signal, confidence 1.00; §10.2's row) — `/pubs/`: `published_doi`.
 *   The preprint's own `ids.doi` is never replaced by the journal DOI.
 * - `type` is always `"preprint"` (§10.2's `type` rules: "any … bioRxiv
 *   record").
 *
 * ## Which `SourceId` — the server field, never the DOI prefix
 *
 * `docs/02` §11.2, verified 2026-09-09: medRxiv mints under `10.64898/` too,
 * "so the prefix does not distinguish bioRxiv from medRxiv — use the
 * publisher/server field". {@link serverOf} reads `server` (`/pubs/`:
 * `preprint_platform`) and the record's `sourceId` **is** that server; the
 * server the request went to is used only when the field is absent or
 * unrecognised, with a warning. Nothing in this file reads a DOI prefix.
 *
 * ## Absent vs. not understood
 *
 * The same two-way split as the other mappers: absent → field absent and in
 * `missingFields` (domain {@link BIORXIV_MAPPABLE_FIELDS}); present but not
 * understood → the same, plus a `warn` line through the injected logger.
 *
 * ## Layering
 *
 * `sources/` may import `core/` and `model/` only (`docs/07` §2.3). Nothing
 * here names the `Zotero` global, reads a preference or issues a request.
 */

import type { Clock } from "../../core/clock";
import type { Logger } from "../../core/logger";
import type {
  Author,
  OpenAccessInfo,
  PartialDate,
  Subject,
} from "../../model/canonicalWork";
import { normalizeDoi, type Doi, type SourceId } from "../../model/ids";
import type { SourceRecord } from "../../model/sourceRecord";
import {
  BIORXIV_SERVER_LABELS,
  type BiorxivEndpoint,
  type BiorxivServer,
} from "./query";

// ---------------------------------------------------------------------------
// 1. Constants
// ---------------------------------------------------------------------------

/** `docs/02` §8.3 / §11.4: the value of `published` when there is no published version. */
export const BIORXIV_NOT_PUBLISHED = "NA";

/** `Subject.scheme` per server: the two category vocabularies are distinct. */
export const BIORXIV_CATEGORY_SCHEMES: Readonly<Record<BiorxivServer, string>> =
  {
    biorxiv: "biorxiv-category",
    medrxiv: "medrxiv-category",
  };

/**
 * The canonical fields `docs/02` §10.2's bioRxiv column (plus §11.4's
 * `relatedVersionIds` row) says a record can supply — the domain of
 * {@link SourceRecord.missingFields}.
 */
export const BIORXIV_MAPPABLE_FIELDS: readonly string[] = [
  "title",
  "abstract",
  "authors",
  "containerTitle",
  "publishedDate",
  "subjects",
  "openAccess",
  "ids.doi",
  "relatedVersionIds",
];

/**
 * Section headings bioRxiv/medRxiv run into the first word of a paragraph
 * (`docs/02` §8.5; measured 2026-10-15 in both endpoints). Matched only at
 * the start of a paragraph and only when glued to an upper-case letter or a
 * digit, so a sentence that merely begins with "Results" is left alone.
 * Longest first, so "Design, Setting, and Participants" wins over "Design".
 */
export const BIORXIV_RUN_IN_HEADINGS: readonly string[] = [
  "Design, Setting, and Participants",
  "Main Outcomes and Measures",
  "Design, Setting and Participants",
  "Methods and Findings",
  "Methods and Results",
  "Conclusions and Relevance",
  "Background and Aims",
  "Introduction",
  "Interpretation",
  "Participants",
  "Significance",
  "Conclusions",
  "Background",
  "Conclusion",
  "Discussion",
  "Importance",
  "Motivation",
  "Objectives",
  "Exposures",
  "Rationale",
  "Objective",
  "Findings",
  "Purpose",
  "Results",
  "Methods",
  "Setting",
  "Summary",
  "Context",
  "Funding",
  "Method",
  "Design",
  "Aims",
  "Aim",
];

// ---------------------------------------------------------------------------
// 2. Small readers
// ---------------------------------------------------------------------------

type Json = Readonly<Record<string, unknown>>;

function asRecord(value: unknown): Json | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Json)
    : undefined;
}

/** A trimmed non-empty string, or `undefined`. */
function str(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * A record's server, from its own field — never from the DOI (`docs/02`
 * §11.2). Case-insensitive: the API writes `"bioRxiv"` / `"medRxiv"`.
 *
 * @param value - `server` (`/details/`) or `preprint_platform` (`/pubs/`)
 * @returns the server, or `undefined` when absent or unrecognised
 */
export function serverOf(value: unknown): BiorxivServer | undefined {
  const text = str(value)?.toLowerCase();
  if (text === "biorxiv") return "biorxiv";
  if (text === "medrxiv") return "medrxiv";
  return undefined;
}

/** `YYYY-MM-DD`, the shape `date` and `preprint_date` take (`docs/02` §8.3). */
const FULL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;

/**
 * `date` → `docs/07` §5.1's `PartialDate`, at day precision.
 *
 * @returns the date, or `undefined` when it is not a calendar `YYYY-MM-DD`
 */
export function readBiorxivDate(value: unknown): PartialDate | undefined {
  const text = str(value);
  if (text === undefined) return undefined;
  const match = FULL_DATE.exec(text);
  if (match === null) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) {
    return undefined;
  }
  return { year, month, day, iso: text };
}

/**
 * `published` / `published_doi` → the published version's DOI, or
 * `undefined` for `"NA"` and for absence (`docs/02` §11.4's first signal).
 *
 * @returns `{ doi }` when the value is a DOI; `null` when present, not `"NA"`
 *   and not a DOI (the caller warns)
 */
export function readPublishedDoi(
  value: unknown,
): { readonly doi: Doi } | null | undefined {
  const text = str(value);
  if (text === undefined || text === BIORXIV_NOT_PUBLISHED) return undefined;
  const doi = normalizeDoi(text);
  return doi === null ? null : { doi };
}

// ---------------------------------------------------------------------------
// 3. Authors
// ---------------------------------------------------------------------------

/**
 * Split `docs/02` §10.2's `"Last, F.; Last, F."` author string.
 *
 * Each `;`-separated part is `Family, Given`; a part with no comma is kept
 * whole as the family name (a consortium, or a single-name author). Empty
 * parts — a trailing `;` — are dropped.
 *
 * @param authors - the `authors` / `preprint_authors` value
 * @returns the authors, `sequence` 0-based in string order
 */
export function splitBiorxivAuthors(authors: string): Author[] {
  const out: Author[] = [];
  for (const part of authors.split(";")) {
    const name = part.trim();
    if (name === "") continue;
    const comma = name.indexOf(",");
    const family = (comma === -1 ? name : name.slice(0, comma)).trim();
    const given = comma === -1 ? "" : name.slice(comma + 1).trim();
    if (family === "") continue;
    out.push({
      family,
      ...(given !== "" && { given }),
      sequence: out.length,
    });
  }
  return out;
}

/**
 * Mark the corresponding author. `author_corresponding` is a full name
 * (`"Weihan Li"`, `"Xuefeng B Ling"`) while the author list has
 * `"Li, W."`, so the match is: the full name ends with the family name on a
 * word boundary, and — when two authors share that family name — the given
 * names start with the same letter. No unique match → nothing is marked.
 *
 * @returns the authors, with at most one `isCorresponding` (and its
 *   institution as the one affiliation §10.2 supplies)
 */
export function markCorresponding(
  authors: readonly Author[],
  correspondingName: string | undefined,
  institution: string | undefined,
): Author[] {
  if (correspondingName === undefined) return [...authors];
  const full = correspondingName.toLowerCase();
  const byFamily = authors.filter((a) => {
    const family = a.family.toLowerCase();
    return full === family || full.endsWith(` ${family}`);
  });
  const initial = full.charAt(0);
  const candidates =
    byFamily.length > 1
      ? byFamily.filter(
          (a) => (a.given ?? "").toLowerCase().charAt(0) === initial,
        )
      : byFamily;
  const match = candidates.length === 1 ? candidates[0] : undefined;
  if (match === undefined) return [...authors];
  return authors.map((a) =>
    a === match
      ? {
          ...a,
          isCorresponding: true,
          ...(institution !== undefined && { affiliations: [institution] }),
        }
      : a,
  );
}

// ---------------------------------------------------------------------------
// 4. The abstract
// ---------------------------------------------------------------------------

/**
 * `docs/02` §8.5's flattening tokens. `O_SCPCAP` / `C_SCPCAP` wrap small
 * capitals *inside* a word (`AO_SCPCAPBSTRACTC_SCPCAP` → `ABSTRACT`), so they
 * are removed with nothing in their place; the list-item tokens (`O_LI`,
 * `C_LIO_LI`, `C_LI`) separate items, so they become a space.
 */
const SCPCAP_TOKEN = /[OC]_SCPCAP/gu;
const LIST_TOKEN = /C_LIO_LI|O_LI|C_LI/gu;

/** The run-in headings as one pattern, longest first, anchored to a paragraph start. */
const RUN_IN_HEADING = new RegExp(
  `^(${BIORXIV_RUN_IN_HEADINGS.map((h) =>
    h.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"),
  ).join("|")})(?=[A-Z0-9])`,
  "u",
);

/**
 * Clean a bioRxiv / medRxiv abstract: the flattening tokens removed, each
 * paragraph's whitespace squashed, a run-in section heading turned into a
 * `"Heading: "` prefix, paragraphs joined by `\n\n`.
 *
 * @param text - `abstract` or `preprint_abstract`
 * @returns the cleaned abstract; `""` when nothing is left
 */
export function cleanBiorxivAbstract(text: string): string {
  const detokenised = text.replace(SCPCAP_TOKEN, "").replace(LIST_TOKEN, " ");
  return detokenised
    .split(/\n\s*\n/u)
    .map((paragraph) => paragraph.replace(/\s+/gu, " ").trim())
    .filter((paragraph) => paragraph.length > 0)
    .map((paragraph) => paragraph.replace(RUN_IN_HEADING, "$1: "))
    .join("\n\n");
}

// ---------------------------------------------------------------------------
// 5. One record
// ---------------------------------------------------------------------------

/** Which endpoint a collection came from, and which server was asked. */
export interface BiorxivMapContext {
  readonly endpoint: BiorxivEndpoint;
  /** The server in the request path — the fallback when a record names none. */
  readonly requestedServer: BiorxivServer;
}

/** The member names of one endpoint's entries (`docs/02` §8.3). */
interface Members {
  readonly doi: string;
  readonly server: string;
  readonly title: string;
  readonly authors: string;
  readonly corresponding: string;
  readonly institution: string;
  readonly category: string;
  readonly date: string;
  readonly abstract: string;
  readonly published: string;
}

const MEMBERS: Readonly<Record<BiorxivEndpoint, Members>> = {
  details: {
    doi: "doi",
    server: "server",
    title: "title",
    authors: "authors",
    corresponding: "author_corresponding",
    institution: "author_corresponding_institution",
    category: "category",
    date: "date",
    abstract: "abstract",
    published: "published",
  },
  pubs: {
    doi: "preprint_doi",
    server: "preprint_platform",
    title: "preprint_title",
    authors: "preprint_authors",
    corresponding: "preprint_author_corresponding",
    institution: "preprint_author_corresponding_institution",
    category: "preprint_category",
    date: "preprint_date",
    abstract: "preprint_abstract",
    published: "published_doi",
  },
};

/** The warning channel the mapper writes to. */
type Warn = (msg: string, ctx: Record<string, unknown>) => void;

/** A version number, for ordering `/details/` entries; `-1` when absent. */
function versionOf(entry: Json): number {
  const text = str(entry["version"]);
  if (text === undefined || !/^\d+$/u.test(text)) return -1;
  return Number(text);
}

/**
 * Map every entry of one DOI to one record.
 *
 * @param doi - the normalized DOI the entries share
 * @param entries - one DOI's entries, in response order (`/details/`: one per
 *   version; `/pubs/`: normally one)
 */
function mapOne(
  doi: Doi,
  entries: readonly Json[],
  context: BiorxivMapContext,
  retrievedAtEpochMs: number,
  keepRaw: boolean,
  warn: Warn,
): SourceRecord {
  const m = MEMBERS[context.endpoint];
  // The latest version supplies the metadata; ties keep the later entry.
  let latest = entries[0] as Json;
  for (const entry of entries) {
    if (versionOf(entry) >= versionOf(latest)) latest = entry;
  }

  // --- server → SourceId (`docs/02` §11.2: the field, never the prefix) ---
  let server = serverOf(latest[m.server]);
  if (server === undefined) {
    server = context.requestedServer;
    warn("biorxiv mapper: record names no known server; using the one asked", {
      field: "sourceId",
      path: m.server,
      requestedServer: context.requestedServer,
    });
  }
  const sourceId: SourceId = server;

  // --- title, abstract ----------------------------------------------------
  const title = str(latest[m.title]) ?? "";
  const rawAbstract = str(latest[m.abstract]);
  const cleaned =
    rawAbstract === undefined ? "" : cleanBiorxivAbstract(rawAbstract);
  const abstract = cleaned === "" ? undefined : cleaned;

  // --- authors ------------------------------------------------------------
  const authorString = str(latest[m.authors]);
  const authors =
    authorString === undefined
      ? []
      : markCorresponding(
          splitBiorxivAuthors(authorString),
          str(latest[m.corresponding]),
          str(latest[m.institution]),
        );

  // --- date: the earliest version's ---------------------------------------
  let publishedDate: PartialDate | undefined;
  let unreadableDate = false;
  for (const entry of entries) {
    const date = readBiorxivDate(entry[m.date]);
    if (date === undefined) {
      if (str(entry[m.date]) !== undefined) unreadableDate = true;
      continue;
    }
    if (publishedDate === undefined || date.iso < publishedDate.iso) {
      publishedDate = date;
    }
  }
  if (unreadableDate) {
    warn("biorxiv mapper: date not understood", {
      field: "publishedDate",
      path: m.date,
    });
  }

  // --- subjects, licence, published version -------------------------------
  const category = str(latest[m.category]);
  const subjects: Subject[] =
    category === undefined
      ? []
      : [{ term: category, scheme: BIORXIV_CATEGORY_SCHEMES[server] }];
  const license = str(latest["license"]);
  const openAccess: OpenAccessInfo | undefined =
    license === undefined ? undefined : { isOpenAccess: true, license };
  const published = readPublishedDoi(latest[m.published]);
  if (published === null) {
    warn("biorxiv mapper: published value is neither NA nor a DOI", {
      field: "relatedVersionIds",
      path: m.published,
    });
  }

  const work: SourceRecord["work"] = {
    ids: { doi },
    type: "preprint",
    title,
    ...(abstract !== undefined && { abstract }),
    authors,
    containerTitle: BIORXIV_SERVER_LABELS[server],
    ...(publishedDate !== undefined && { publishedDate }),
    ...(subjects.length > 0 && { subjects }),
    ...(openAccess !== undefined && { openAccess }),
    ...(published !== undefined &&
      published !== null && {
        relatedVersionIds: published,
      }),
  };

  return {
    id: `${sourceId}:${doi}`,
    sourceId,
    nativeId: doi,
    work,
    retrievedAtEpochMs,
    ...(keepRaw && { raw: entries.length === 1 ? entries[0] : entries }),
    missingFields: collectMissingFields(work),
  };
}

/** Every {@link BIORXIV_MAPPABLE_FIELDS} member the record did not supply. */
function collectMissingFields(work: SourceRecord["work"]): readonly string[] {
  const present = new Set<string>(["containerTitle", "ids.doi"]);
  if (work.title.length > 0) present.add("title");
  if (work.abstract !== undefined) present.add("abstract");
  if (work.authors.length > 0) present.add("authors");
  if (work.publishedDate !== undefined) present.add("publishedDate");
  if (work.subjects !== undefined) present.add("subjects");
  if (work.openAccess !== undefined) present.add("openAccess");
  if (work.relatedVersionIds !== undefined) present.add("relatedVersionIds");
  return BIORXIV_MAPPABLE_FIELDS.filter((f) => !present.has(f));
}

// ---------------------------------------------------------------------------
// 6. The mapper
// ---------------------------------------------------------------------------

/** What {@link createBiorxivRecordMapper} needs from the composition root. */
export interface BiorxivMapperDeps {
  /** `src/core/clock.ts`. Supplies `SourceRecord.retrievedAtEpochMs`. */
  readonly clock: Clock;
  /**
   * `docs/07` §5.1 / §8.5's `logRequestBodies`, resolved by the composition
   * root. `true` keeps each record's own entries as `raw`; `false` — the
   * default, and what NFR-7 requires — keeps nothing.
   */
  readonly keepRaw?: boolean;
  /** Diagnostics. Never given an abstract or a whole entry. */
  readonly logger?: Logger;
}

/**
 * The mapper as `biorxivSource.ts` consumes it: one response's `collection`
 * in, one record per distinct DOI out, in first-seen order. Entries with no
 * usable DOI are dropped with a warning.
 */
export type BiorxivRecordMapper = (
  collection: readonly unknown[],
  context: BiorxivMapContext,
) => readonly SourceRecord[];

/**
 * Build the mapper — one for both servers; the server comes from each record.
 *
 * @param deps - the clock, and optionally `keepRaw` and a logger
 */
export function createBiorxivRecordMapper(
  deps: BiorxivMapperDeps,
): BiorxivRecordMapper {
  const keepRaw = deps.keepRaw ?? false;
  return (collection, context) => {
    const warn: Warn = (msg, ctx) => {
      deps.logger?.warn(msg, {
        sourceId: context.requestedServer,
        endpoint: context.endpoint,
        ...ctx,
      });
    };
    const now = deps.clock.now();
    const doiMember = MEMBERS[context.endpoint].doi;
    const groups = new Map<Doi, Json[]>();
    for (const item of collection) {
      const entry = asRecord(item);
      const doi = normalizeDoi(str(entry?.[doiMember]));
      if (entry === undefined || doi === null) {
        warn("biorxiv mapper: entry has no usable DOI, dropped", {
          field: "nativeId",
          path: doiMember,
        });
        continue;
      }
      const group = groups.get(doi);
      if (group === undefined) groups.set(doi, [entry]);
      else group.push(entry);
    }
    return [...groups].map(([doi, entries]) =>
      mapOne(doi, entries, context, now, keepRaw, warn),
    );
  };
}
